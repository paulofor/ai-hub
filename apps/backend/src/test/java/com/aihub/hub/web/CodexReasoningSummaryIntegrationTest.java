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

    @Test
    void repeatedPrRequestsPreserveSeparateDeliveriesAndTheirMetrics() throws Exception {
        List<CodexRequest> requests = new ArrayList<>();
        for (int number : List.of(10, 11, 12)) {
            CodexRequest request = new CodexRequest("test/delivery@main", "gpt-6-astra", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "Entrega sintética " + number);
            request.setStatus(CodexRequestStatus.COMPLETED);
            request.setResponseText("Entrega sintética confirmada " + number);
            request.setWorkBranch("shared-delivery-branch");
            request.setWorkBatchKey("shared-delivery-branch");
            request.setPullRequestUrl("https://github.com/test/delivery/pull/" + number);
            request.setTotalTokens(42);
            request.setDurationMs(60_000L);
            repository.saveAndFlush(request);
            requestIds.add(request.getId());
            requests.add(request);
        }
        CodexRequest current = requests.get(1);
        for (int attempt = 0; attempt < 2; attempt++) {
            mvc.perform(post("/api/codex/requests/{id}/create-pr", current.getId()).header("X-Role", "owner"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value(current.getPullRequestUrl()));
        }
        List<ObjectNode> details = new ArrayList<>();
        for (CodexRequest original : requests) {
            CodexRequest saved = repository.findById(original.getId()).orElseThrow();
            assertThat(saved.getPullRequestUrl()).isEqualTo(original.getPullRequestUrl());
            assertThat(saved.getStatus()).isEqualTo(CodexRequestStatus.COMPLETED);
            assertThat(saved.getTotalTokens()).isEqualTo(42);
            assertThat(saved.getDurationMs()).isEqualTo(60_000L);
            assertThat(saved.getResponseText()).isEqualTo(original.getResponseText());
            assertThat(saved.getWorkBatchKey()).isEqualTo(original == current ? null : "shared-delivery-branch");
            String detail = mvc.perform(get("/api/codex/requests/{id}", saved.getId()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.pullRequestUrl").value(original.getPullRequestUrl()))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            details.add((ObjectNode) mapper.readTree(detail));
        }
        String detailPath = System.getenv("DELIVERY_HISTORY_E2E_DETAIL");
        if (detailPath != null) Files.writeString(Path.of(detailPath), mapper.writeValueAsString(details));
    }

    @Test
    void callbackPersistsFinalizationOutcomeAndPreservesResultForTheFrontend() throws Exception {
        List<ObjectNode> details = new ArrayList<>();
        for (String outcome : List.of("COMPLETED", "FAILED")) {
            String answer = mapper.writeValueAsString(mapper.createObjectNode()
                .put("titulo", "Resultado local de teste")
                .put("comentario", "Implementação integrada pelo PR de teste.")
                .put("impactoAumentoVendas", "medio").put("alterouCodigoRepositorio", true)
                .put("resumoCodigoPr", "Corrige encerramento.").put("sugestaoMelhoriaAmbiente", ""));
            CodexRequest request = new CodexRequest("sandbox.local", "gpt-6-astra", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "Teste de encerramento");
            request.setExternalId("finalization-test-" + outcome);
            request.setStatus(CodexRequestStatus.RUNNING);
            repository.saveAndFlush(request);
            requestIds.add(request.getId());
            ObjectNode payload = mapper.createObjectNode().put("jobId", request.getExternalId())
                .put("status", outcome).put("summary", answer).put("promptTokens", 30)
                .put("completionTokens", 12).put("totalTokens", 42)
                .put("startedAt", "2026-09-20T12:00:00Z").put("finishedAt", "2026-09-20T12:01:00Z");
            if (outcome.equals("FAILED")) payload.put("error", "A branch remota divergiu; código local preservado.");

            for (int attempt = 0; attempt < 2; attempt++) {
                mvc.perform(post("/api/codex/requests/callbacks/sandbox")
                        .header("X-Sandbox-Callback-Token", "synthetic-summary-callback")
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload)))
                    .andExpect(status().isAccepted());
            }
            CodexRequest saved = repository.findById(request.getId()).orElseThrow();
            assertThat(saved.getStatus().name()).isEqualTo(outcome);
            assertThat(saved.getTotalTokens()).isEqualTo(42);
            assertThat(saved.getDurationMs()).isEqualTo(60_000L);
            String comment = mapper.readTree(saved.getResponseText()).path("comentario").asText();
            assertThat(comment).contains("Implementação integrada pelo PR de teste.");
            if (outcome.equals("FAILED")) {
                assertThat(comment).contains("Falha no encerramento", "A branch remota divergiu");
                assertThat(comment.indexOf("Falha no encerramento")).isEqualTo(comment.lastIndexOf("Falha no encerramento"));
            } else {
                assertThat(saved.getResponseText()).isEqualTo(answer);
            }
            String body = mvc.perform(get("/api/codex/requests/{id}", request.getId()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value(outcome))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            details.add((ObjectNode) mapper.readTree(body));
        }
        String detailPath = System.getenv("FINALIZATION_E2E_DETAIL");
        if (detailPath != null) Files.writeString(Path.of(detailPath), mapper.writeValueAsString(details));
    }
}
