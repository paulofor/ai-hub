package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.EnvironmentRecord;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
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
class CodexQueueIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private CodexRequestRepository requests;
    @Autowired private EnvironmentRepository environments;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void queueIncludesAllActiveEnvironmentsBeyondRecentHistoryWithoutLoadingAgentContext() throws Exception {
        var profile = CodexIntegrationProfile.CHATGPT_CODEX_MKT;
        var oldest = save(profile, "test/old@main", CodexRequestStatus.RUNNING, 0);
        oldest.setExternalId("synthetic-running");
        requests.saveAndFlush(oldest);
        long firstPending = 0;
        for (int i = 1; i <= 26; i++) {
            var pending = save(profile, i % 2 == 0 ? "test/stag@main" : "test/sisacao@main", CodexRequestStatus.PENDING, i);
            if (i == 1) firstPending = pending.getId();
        }
        for (var status : new CodexRequestStatus[] { CodexRequestStatus.COMPLETED, CodexRequestStatus.FAILED, CodexRequestStatus.CANCELLED }) {
            for (int i = 0; i < 10; i++) save(profile, "test/recent@main", status, 100 + i);
        }
        save(CodexIntegrationProfile.CHATGPT_CODEX, "test/other-profile@main", CodexRequestStatus.RUNNING, 0);
        clearInvocations(sandbox);
        long count = requests.count();

        String body = mvc.perform(get("/api/codex/requests/queue").param("profile", profile.name()))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.profile").value(profile.name())).andExpect(jsonPath("$.updatedAt").isNotEmpty())
            .andExpect(jsonPath("$.requests.length()").value(27))
            .andExpect(jsonPath("$.requests[0].id").value(oldest.getId()))
            .andExpect(jsonPath("$.requests[0].status").value("RUNNING"))
            .andExpect(jsonPath("$.requests[0].queuePosition").value(0))
            .andExpect(jsonPath("$.requests[1].id").value(firstPending))
            .andExpect(jsonPath("$.requests[1].queuePosition").value(1))
            .andExpect(jsonPath("$.requests[26].queuePosition").value(26))
            .andExpect(jsonPath("$.requests[1].requestTitle").value("Pedido sintético 1"))
            .andExpect(jsonPath("$.requests[1].reasoningEffort").value("high"))
            .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("INTERNAL_PROMPT_TEST_ONLY", "INTERNAL_LOG_TEST_ONLY", "promptTokens", "responseText");
        assertThat(requests.count()).isEqualTo(count);
        assertThat(requests.findById(oldest.getId()).orElseThrow().getStatus()).isEqualTo(CodexRequestStatus.RUNNING);
        verifyNoInteractions(sandbox);
    }

    @Test
    void separateSessionsSeeAcceptedEditsAndCancellationWithoutDispatchingParallelWork() throws Exception {
        var profile = CodexIntegrationProfile.CHATGPT_CODEX;
        environments.saveAndFlush(new EnvironmentRecord("test/stag@main", "Fixture local"));
        var running = save(profile, "test/sisacao@main", CodexRequestStatus.RUNNING, 0);
        running.setExternalId("synthetic-active-job");
        requests.saveAndFlush(running);
        var computerA = new MockHttpSession();
        var computerB = new MockHttpSession();
        clearInvocations(sandbox);
        String created = mvc.perform(post("/api/codex/requests").session(computerA).contentType(MediaType.APPLICATION_JSON).content("""
            {"environment":"test/stag@main","model":"gpt-6.1-sol","profile":"CHATGPT_CODEX",
             "prompt":"INTERNAL_PROMPT_TEST_ONLY","userMessage":"Pedido do computador A"}
            """))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"))
            .andReturn().getResponse().getContentAsString();
        long id = mapper.readTree(created).path("id").asLong();
        assertThat(id).isGreaterThan(running.getId());
        mvc.perform(get("/api/codex/requests/queue").session(computerB).param("profile", profile.name()))
            .andExpect(jsonPath("$.requests.length()").value(2))
            .andExpect(jsonPath("$.requests[1].id").value(id))
            .andExpect(jsonPath("$.requests[1].requestTitle").value("Pedido do computador A"));
        mvc.perform(patch("/api/codex/requests/{id}", id).session(computerB).contentType(MediaType.APPLICATION_JSON)
                .content("{\"prompt\":\"INTERNAL_PROMPT_TEST_ONLY\",\"userMessage\":\"Editado no computador B\"}"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/codex/requests/queue").session(computerA).param("profile", profile.name()))
            .andExpect(jsonPath("$.requests[1].requestTitle").value("Editado no computador B"));
        mvc.perform(post("/api/codex/requests/{id}/cancel", id).session(computerB)).andExpect(status().isOk());
        mvc.perform(get("/api/codex/requests/queue").session(computerA).param("profile", profile.name()))
            .andExpect(jsonPath("$.requests.length()").value(1))
            .andExpect(jsonPath("$.requests[0].id").value(running.getId()));
        assertThat(requests.findById(id).orElseThrow().getExternalId()).isNull();
        verifyNoInteractions(sandbox);
    }

    @Test
    void validatesProfileHandlesEmptyQueueAndLegacyRequestsAndPreservesTieOrder() throws Exception {
        mvc.perform(get("/api/codex/requests/queue")).andExpect(status().isBadRequest());
        for (String invalid : new String[] { "", " ", "invalid" }) {
            mvc.perform(get("/api/codex/requests/queue").param("profile", invalid)).andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/codex/requests/queue").param("profile", "CHATGPT_CODEX_SANDBOX"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.requests.length()").value(0));
        var first = save(CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX, "sandbox", CodexRequestStatus.PENDING, 1);
        first.setUserMessage(null);
        requests.saveAndFlush(first);
        var second = save(CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX, "sandbox", CodexRequestStatus.PENDING, 1);
        mvc.perform(get("/api/codex/requests/queue").param("profile", "CHATGPT_CODEX_SANDBOX"))
            .andExpect(jsonPath("$.requests[0].id").value(first.getId()))
            .andExpect(jsonPath("$.requests[0].requestTitle").value("Solicitação #" + first.getId()))
            .andExpect(jsonPath("$.requests[1].id").value(second.getId()));
        first.setStatus(CodexRequestStatus.COMPLETED);
        requests.saveAndFlush(first);
        second.setStatus(CodexRequestStatus.RUNNING);
        requests.saveAndFlush(second);
        mvc.perform(get("/api/codex/requests/queue").param("profile", "CHATGPT_CODEX_SANDBOX"))
            .andExpect(jsonPath("$.requests.length()").value(1))
            .andExpect(jsonPath("$.requests[0].status").value("RUNNING"));
    }

    private CodexRequest save(CodexIntegrationProfile profile, String environment, CodexRequestStatus status, int second) {
        var request = new CodexRequest(environment, "gpt-6.1-sol", profile, "INTERNAL_PROMPT_TEST_ONLY");
        request.setUserMessage("Pedido sintético " + second);
        request.setReasoningEffort(CodexReasoningEffort.HIGH);
        request.setStatus(status);
        request.setCreatedAt(Instant.parse("2026-10-01T00:00:00Z").plusSeconds(second));
        request.setExecutionLog("INTERNAL_LOG_TEST_ONLY");
        return requests.saveAndFlush(request);
    }
}
