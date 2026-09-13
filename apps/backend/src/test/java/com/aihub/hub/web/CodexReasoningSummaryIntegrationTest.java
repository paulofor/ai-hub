package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:reasoning-summary-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "hub.sandbox.callback.secret=synthetic-summary-callback",
    "hub.codex.app-server-enabled=false"
})
class CodexReasoningSummaryIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private CodexRequestRepository repository;
    @MockBean private SandboxOrchestratorClient sandboxClient;
    @MockBean private GithubApiClient githubClient;
    private final List<Long> requestIds = new ArrayList<>();

    @AfterEach
    void deleteCommittedFixtures() {
        repository.deleteAllById(requestIds);
    }

    @Test
    void callbackPersistsPublicSummaryAndDetailReturnsItWithoutMixingRequests() throws Exception {
        String payloadPath = System.getenv("REASONING_SUMMARY_E2E_PAYLOAD");
        ObjectNode payload = payloadPath == null ? mapper.createObjectNode()
            .put("jobId", "summary-test-CHATGPT_CODEX").put("status", "COMPLETED")
            .put("summary", "Resumo Codex App Server")
            .put("reasoningSummary", "Resumo público validado por JSON-RPC.")
            : (ObjectNode) mapper.readTree(Files.readString(Path.of(payloadPath)));
        String publicSummary = payload.path("reasoningSummary").asText();
        String answer = payload.path("summary").asText();
        assertThat(publicSummary).isNotBlank();

        CodexRequest request = new CodexRequest("sandbox.local", "gpt-6-astra", CodexIntegrationProfile.CHATGPT_CODEX, "Validação local");
        request.setExternalId(payload.path("jobId").asText());
        request.setStatus(CodexRequestStatus.RUNNING);
        // The callback reads in REQUIRES_NEW, so its fixtures must already be committed.
        repository.saveAndFlush(request);
        Long id = request.getId();
        requestIds.add(id);
        CodexRequest other = new CodexRequest("sandbox.local", "gpt-6-astra", CodexIntegrationProfile.CHATGPT_CODEX, "Outra solicitação");
        other.setStatus(CodexRequestStatus.COMPLETED);
        other.setResponseText("Resposta de outra solicitação.");
        repository.saveAndFlush(other);
        Long otherId = other.getId();
        requestIds.add(otherId);

        mvc.perform(post("/api/codex/requests/callbacks/sandbox").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(payload)))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/codex/requests/callbacks/sandbox")
                .header("X-Sandbox-Callback-Token", "synthetic-summary-callback")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload)))
            .andExpect(status().isAccepted()).andExpect(jsonPath("$.updated").value(true));

        assertThat(repository.findById(id).orElseThrow().getReasoningSummary()).isEqualTo(publicSummary);
        assertThat(repository.findById(otherId).orElseThrow().getReasoningSummary()).isNull();
        String detail = mvc.perform(get("/api/codex/requests/{id}", id))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reasoningSummary").value(publicSummary))
            .andExpect(jsonPath("$.responseText").value(answer))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);

        // An older or incomplete callback must not erase a summary already received.
        for (String empty : new String[] { "", "   " }) {
            ObjectNode update = mapper.createObjectNode().put("jobId", request.getExternalId())
                .put("status", "COMPLETED").put("reasoningSummary", empty);
            mvc.perform(post("/api/codex/requests/callbacks/sandbox")
                    .header("X-Sandbox-Callback-Token", "synthetic-summary-callback")
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(update)))
                .andExpect(status().isAccepted());
        }
        assertThat(repository.findById(id).orElseThrow().getReasoningSummary()).isEqualTo(publicSummary);
        assertThat(repository.findById(id).orElseThrow().getResponseText()).isEqualTo(answer);

        String detailPath = System.getenv("REASONING_SUMMARY_E2E_DETAIL");
        if (detailPath != null) Files.writeString(Path.of(detailPath), detail);
    }
}
