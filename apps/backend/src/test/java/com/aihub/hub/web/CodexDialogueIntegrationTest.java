package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:codex-queue-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "spring.flyway.enabled=true",
    "spring.flyway.locations=classpath:db/migration/h2",
    "spring.jpa.hibernate.ddl-auto=validate",
    "hub.codex.app-server-enabled=false"
})
@Transactional
class CodexDialogueIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private CodexRequestRepository requests;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void selectsTenLatestRequestsOfProfileBeforeLimitingWithPublicConversationContent() throws Exception {
        var profile = CodexIntegrationProfile.CHATGPT_CODEX_MKT;
        for (int i = 0; i < 12; i++) save(profile, i, CodexRequestStatus.values()[i % 5]);
        for (int i = 100; i < 125; i++) save(CodexIntegrationProfile.CHATGPT_CODEX, i, CodexRequestStatus.COMPLETED);
        clearInvocations(sandbox);
        long count = requests.count();

        // The history list deliberately remains a summary, rather than a conversation API.
        mvc.perform(get("/api/codex/requests").param("page", "0").param("size", "20").param("profile", profile.name()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].userMessage").doesNotExist())
            .andExpect(jsonPath("$.content[0].responseText").doesNotExist());

        String body = mvc.perform(get("/api/codex/requests/recent-dialogue").param("profile", profile.name()).param("size", "100"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.length()").value(10))
            .andExpect(jsonPath("$[0].profile").value(profile.name()))
            .andExpect(jsonPath("$[0].userMessage").value("Pedido sintético 11"))
            .andExpect(jsonPath("$[0].responseText").value("Resposta sintética 11"))
            .andExpect(jsonPath("$[0].productName").value("Produto de teste"))
            .andExpect(jsonPath("$[0].reasoningEffort").value("high"))
            .andExpect(jsonPath("$[9].userMessage").value("Pedido sintético 2"))
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        var rows = mapper.readTree(body);
        for (int i = 0; i < 10; i++) {
            assertThat(rows.get(i).path("userMessage").asText()).isEqualTo("Pedido sintético " + (11 - i));
            assertThat(rows.get(i).path("profile").asText()).isEqualTo(profile.name());
        }
        assertThat(body).doesNotContain("INTERNAL_", "prompt", "executionLog", "modelTranscript", "imageAttachments", "quotaUsage");
        assertThat(requests.count()).isEqualTo(count);
        verifyNoInteractions(sandbox);
    }

    @Test
    void validatesRequiredProfileAndUsesStableIdOrderForEqualTimestamps() throws Exception {
        mvc.perform(get("/api/codex/requests/recent-dialogue")).andExpect(status().isBadRequest());
        for (String invalid : new String[] { "", " ", "invalid" }) {
            mvc.perform(get("/api/codex/requests/recent-dialogue").param("profile", invalid))
                .andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/codex/requests/recent-dialogue").param("profile", "CHATGPT_CODEX_SANDBOX"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        var first = save(CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX, 0, CodexRequestStatus.FAILED);
        var second = save(CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX, 0, CodexRequestStatus.CANCELLED);
        second.setUserMessage(null);
        second.setResponseText(null);
        requests.saveAndFlush(second);
        mvc.perform(get("/api/codex/requests/recent-dialogue").param("profile", "chatgpt-codex-sandbox"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(second.getId()))
            .andExpect(jsonPath("$[0].status").value("CANCELLED"))
            .andExpect(jsonPath("$[1].id").value(first.getId()));
    }

    @Test
    void separateSessionsReadLatestCompletionWithoutDispatchingOrChangingMetrics() throws Exception {
        var request = save(CodexIntegrationProfile.CHATGPT_CODEX, 0, CodexRequestStatus.RUNNING);
        var originalInteractionCount = request.getInteractionCount();
        var computerA = new MockHttpSession();
        var computerB = new MockHttpSession();
        clearInvocations(sandbox);
        mvc.perform(get("/api/codex/requests/recent-dialogue").session(computerA).param("profile", "CHATGPT_CODEX"))
            .andExpect(jsonPath("$[0].status").value("RUNNING"));
        request.setStatus(CodexRequestStatus.COMPLETED);
        request.setFinishedAt(Instant.parse("2026-10-01T00:01:00Z"));
        request.setResponseText("Resposta final pública");
        requests.saveAndFlush(request);
        for (var session : new MockHttpSession[] { computerA, computerB }) {
            mvc.perform(get("/api/codex/requests/recent-dialogue").session(session).param("profile", "CHATGPT_CODEX"))
                .andExpect(jsonPath("$[0].status").value("COMPLETED"))
                .andExpect(jsonPath("$[0].responseText").value("Resposta final pública"))
                .andExpect(jsonPath("$[0].finishedAt").value("2026-10-01T00:01:00Z"));
        }
        assertThat(requests.findById(request.getId()).orElseThrow().getInteractionCount()).isEqualTo(originalInteractionCount);
        verifyNoInteractions(sandbox);
    }

    private CodexRequest save(CodexIntegrationProfile profile, int second, CodexRequestStatus status) {
        var request = new CodexRequest("test/dialogue@main", "gpt-6.1-sol", profile, "INTERNAL_PROMPT_TEST_ONLY");
        request.setReasoningEffort(CodexReasoningEffort.HIGH);
        request.setStatus(status);
        request.setUserMessage("Pedido sintético " + second);
        request.setResponseText("Resposta sintética " + second);
        request.setProductName("Produto de teste");
        request.setExecutionLog("INTERNAL_LOG_TEST_ONLY");
        request.setModelTranscript("INTERNAL_TRANSCRIPT_TEST_ONLY");
        request.setCreatedAt(Instant.parse("2026-10-01T00:00:00Z").plusSeconds(second));
        return requests.saveAndFlush(request);
    }
}
