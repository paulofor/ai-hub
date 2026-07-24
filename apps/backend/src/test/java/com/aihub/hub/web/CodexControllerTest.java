package com.aihub.hub.web;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.service.CodexRequestService;
import com.aihub.hub.service.PullRequestService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.ZipInputStream;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.client.RestClientResponseException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;

class CodexControllerTest {

    @Test
    void previousReturnsNearestLowerRequestId() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());

        when(codexRequestService.previousRequestId(10L)).thenReturn(Optional.of(9L));

        ResponseEntity<Map<String, Long>> response = controller.previous(10L);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsEntry("id", 9L);
    }

    @Test
    void previousReturnsNoContentWhenThereIsNoLowerRequestId() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());

        when(codexRequestService.previousRequestId(1L)).thenReturn(Optional.empty());

        ResponseEntity<Map<String, Long>> response = controller.previous(1L);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(response.getBody()).isNull();
    }

    @Test
    void downloadInteractionsUsesPersistedSummaryCountWhenDetailedRowsAreEmpty() throws Exception {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        CodexController controller = new CodexController(codexRequestService, pullRequestService, objectMapper);

        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5.5", null, "prompt");
        ReflectionTestUtils.setField(request, "id", 1434L);
        request.setInteractionCount(7);

        when(codexRequestService.listInteractions(1434L)).thenReturn(List.of());
        when(codexRequestService.find(1434L)).thenReturn(request);

        byte[] zipBytes = controller.downloadInteractions(1434L).getBody();

        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            assertThat(zip.getNextEntry()).isNotNull();
            JsonNode payload = objectMapper.readTree(zip.readAllBytes());
            assertThat(payload.path("interactionCount").asInt()).isEqualTo(7);
            assertThat(payload.path("interactions")).isEmpty();
        }
    }


    @Test
    void createPrUsesFinalAssistantResponseAsCompleteExplanation() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        ObjectMapper objectMapper = new ObjectMapper();
        CodexController controller = new CodexController(codexRequestService, pullRequestService, objectMapper);

        CodexRequest completedRequest = new CodexRequest("paulofor/marketing-hub", "gpt-5.5", null, "prompt");
        ReflectionTestUtils.setField(completedRequest, "id", 730L);
        completedRequest.setStatus(CodexRequestStatus.COMPLETED);
        completedRequest.setResponseText("Resumo final completo do modelo para o PR.");

        ResponseRecord response = new ResponseRecord();
        response.setUnifiedDiff("diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-antigo\n+novo");
        response.setFixPlan("Plano resumido antigo");

        when(codexRequestService.find(730L)).thenReturn(completedRequest);
        when(codexRequestService.findLatestResponseForEnvironment("paulofor/marketing-hub")).thenReturn(Optional.of(response));
        when(pullRequestService.createFixPr(
            eq("codex-ui"),
            eq("paulofor"),
            eq("marketing-hub"),
            eq("main"),
            eq("AI Hub: Correção da solicitação #730"),
            eq(response.getUnifiedDiff()),
            org.mockito.ArgumentMatchers.anyString()
        )).thenReturn(objectMapper.createObjectNode().put("html_url", "https://github.com/paulofor/marketing-hub/pull/1").put("number", 1));

        controller.createPr(730L, "owner", "codex-ui");

        ArgumentCaptor<String> explanationCaptor = ArgumentCaptor.forClass(String.class);
        verify(pullRequestService).createFixPr(
            eq("codex-ui"),
            eq("paulofor"),
            eq("marketing-hub"),
            eq("main"),
            eq("AI Hub: Correção da solicitação #730"),
            eq(response.getUnifiedDiff()),
            explanationCaptor.capture()
        );
        assertThat(explanationCaptor.getValue()).isEqualTo("Resumo final completo do modelo para o PR.");
    }

    @Test
    void createPrRejectsFailedRequestBeforeLookingForReusableResponse() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());
        CodexRequest failedRequest = new CodexRequest("paulofor/marketing-hub", "gpt-5.5", null, "falhou");
        failedRequest.setStatus(CodexRequestStatus.FAILED);
        when(codexRequestService.find(727L)).thenReturn(failedRequest);

        assertThatThrownBy(() -> controller.createPr(727L, "owner", "codex-ui"))
            .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(ex.getReason()).isEqualTo("Só é possível criar PR para uma solicitação concluída com sucesso");
            });

        verify(codexRequestService, never()).findLatestResponseForEnvironment("paulofor/marketing-hub");
        verify(pullRequestService, never()).createFixPr(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString()
        );
    }

    @Test
    void createPrReusesPullRequestUrlFoundInBatchResponseText() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());

        CodexRequest completedRequest = new CodexRequest("paulofor/marketing-hub", "gpt-5.5", null, "prompt");
        ReflectionTestUtils.setField(completedRequest, "id", 731L);
        completedRequest.setStatus(CodexRequestStatus.COMPLETED);
        completedRequest.setWorkBranch("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");
        completedRequest.setResponseText("PR criado: https://github.com/paulofor/marketing-hub/pull/4295");

        when(codexRequestService.find(731L)).thenReturn(completedRequest);
        when(codexRequestService.listBatch(completedRequest)).thenReturn(List.of(completedRequest));

        Map<String, Object> payload = controller.createPr(731L, "owner", "codex-ui");

        assertThat(payload.get("url")).isEqualTo("https://github.com/paulofor/marketing-hub/pull/4295");
        verify(codexRequestService).markPullRequestCreatedForBatch(completedRequest, "https://github.com/paulofor/marketing-hub/pull/4295");
        verify(pullRequestService, never()).createDraftPrFromBranch(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString()
        );
    }

    @Test
    void createPrReturnsBadRequestWhenGithubRejectsBatchBranch() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());

        CodexRequest completedRequest = new CodexRequest("paulofor/marketing-hub", "gpt-5.5", null, "prompt");
        ReflectionTestUtils.setField(completedRequest, "id", 732L);
        completedRequest.setStatus(CodexRequestStatus.COMPLETED);
        completedRequest.setWorkBranch("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");

        when(codexRequestService.find(732L)).thenReturn(completedRequest);
        when(codexRequestService.listBatch(completedRequest)).thenReturn(List.of(completedRequest));
        when(pullRequestService.inspectBranchPublicationReadiness(
            eq("paulofor"),
            eq("marketing-hub"),
            eq("main"),
            eq("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt")
        )).thenReturn(new PullRequestService.BranchPublicationReadiness(
            List.of("apps/backend/src/main/java/App.java"),
            List.of("apps/backend/src/main/java/App.java")
        ));
        when(pullRequestService.createDraftPrFromBranch(
            eq("codex-ui"),
            eq("paulofor"),
            eq("marketing-hub"),
            eq("main"),
            eq("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt"),
            eq("AI Hub: lote Codex #732"),
            org.mockito.ArgumentMatchers.anyString()
        )).thenThrow(new RestClientResponseException(
            "422 Unprocessable Entity",
            422,
            "Unprocessable Entity",
            null,
            "{\"message\":\"Validation Failed\",\"errors\":[{\"field\":\"head\",\"code\":\"invalid\"}]}".getBytes(StandardCharsets.UTF_8),
            StandardCharsets.UTF_8
        ));

        assertThatThrownBy(() -> controller.createPr(732L, "owner", "codex-ui"))
            .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(ex.getReason()).isEqualTo("GitHub recusou a criação do PR do lote: Validation Failed");
            });
    }

    @Test
    void createPrCreatesDraftPullRequestFromReadyBatchBranch() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        ObjectMapper objectMapper = new ObjectMapper();
        CodexController controller = new CodexController(codexRequestService, pullRequestService, objectMapper);

        CodexRequest firstRequest = new CodexRequest("paulofor/marketing-hub@main", "gpt-5.4-mini", null, "criar md");
        ReflectionTestUtils.setField(firstRequest, "id", 740L);
        firstRequest.setStatus(CodexRequestStatus.COMPLETED);
        firstRequest.setWorkBranch("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");
        firstRequest.setWorkBatchKey("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");

        CodexRequest secondRequest = new CodexRequest("paulofor/marketing-hub@main", "gpt-5.4-mini", null, "analisar sem mudanca");
        ReflectionTestUtils.setField(secondRequest, "id", 741L);
        secondRequest.setStatus(CodexRequestStatus.COMPLETED);
        secondRequest.setWorkBranch("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");
        secondRequest.setWorkBatchKey("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");

        when(codexRequestService.find(740L)).thenReturn(firstRequest);
        when(codexRequestService.listBatch(firstRequest)).thenReturn(List.of(firstRequest, secondRequest));
        when(pullRequestService.inspectBranchPublicationReadiness(
            eq("paulofor"),
            eq("marketing-hub"),
            eq("main"),
            eq("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt")
        )).thenReturn(new PullRequestService.BranchPublicationReadiness(
            List.of("docs/aihub-lote-mkt-pr-test-20260711.md", "docs/diario/registros1.md"),
            List.of("docs/aihub-lote-mkt-pr-test-20260711.md")
        ));
        when(pullRequestService.createDraftPrFromBranch(
            eq("codex-ui"),
            eq("paulofor"),
            eq("marketing-hub"),
            eq("main"),
            eq("ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt"),
            eq("AI Hub: lote Codex #740"),
            org.mockito.ArgumentMatchers.anyString()
        )).thenReturn(objectMapper.createObjectNode()
            .put("html_url", "https://github.com/paulofor/marketing-hub/pull/740")
            .put("number", 740));

        Map<String, Object> payload = controller.createPr(740L, "owner", "codex-ui");

        assertThat(payload)
            .containsEntry("number", 740)
            .containsEntry("url", "https://github.com/paulofor/marketing-hub/pull/740")
            .containsEntry("title", "AI Hub: lote Codex #740")
            .containsEntry("workBranch", "ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt");
        assertThat(payload.get("changedFiles")).isEqualTo(List.of("docs/aihub-lote-mkt-pr-test-20260711.md", "docs/diario/registros1.md"));
        assertThat(payload.get("functionalFiles")).isEqualTo(List.of("docs/aihub-lote-mkt-pr-test-20260711.md"));
        verify(codexRequestService).markPullRequestCreatedForBatch(firstRequest, "https://github.com/paulofor/marketing-hub/pull/740");
    }

    @Test
    void createPrRejectsBatchWithPendingRequests() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());

        CodexRequest completedRequest = new CodexRequest("paulofor/ai-hub@main", "gpt-5.5", null, "prompt");
        ReflectionTestUtils.setField(completedRequest, "id", 733L);
        completedRequest.setStatus(CodexRequestStatus.COMPLETED);
        completedRequest.setWorkBranch("ai-hub/codex-paulofor-ai-hub-main-chatgpt_codex_mkt");

        CodexRequest pendingRequest = new CodexRequest("paulofor/ai-hub@main", "gpt-5.5", null, "prompt pendente");
        ReflectionTestUtils.setField(pendingRequest, "id", 734L);
        pendingRequest.setStatus(CodexRequestStatus.PENDING);
        pendingRequest.setWorkBranch("ai-hub/codex-paulofor-ai-hub-main-chatgpt_codex_mkt");

        when(codexRequestService.find(733L)).thenReturn(completedRequest);
        when(codexRequestService.listBatch(completedRequest)).thenReturn(List.of(completedRequest, pendingRequest));

        assertThatThrownBy(() -> controller.createPr(733L, "owner", "codex-ui"))
            .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(ex.getReason()).isEqualTo("Ainda há solicitação pendente ou em execução no lote. Aguarde concluir antes de pedir PR.");
            });

        verify(pullRequestService, never()).inspectBranchPublicationReadiness(anyString(), anyString(), anyString(), anyString());
        verify(pullRequestService, never()).createDraftPrFromBranch(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString()
        );
    }

    @Test
    void createPrRejectsBatchWithOnlyRequiredDiaryChanges() {
        CodexRequestService codexRequestService = mock(CodexRequestService.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        CodexController controller = new CodexController(codexRequestService, pullRequestService, new ObjectMapper());

        CodexRequest completedRequest = new CodexRequest("paulofor/ai-hub@main", "gpt-5.5", null, "prompt");
        ReflectionTestUtils.setField(completedRequest, "id", 735L);
        completedRequest.setStatus(CodexRequestStatus.COMPLETED);
        completedRequest.setWorkBranch("ai-hub/codex-paulofor-ai-hub-main-chatgpt_codex_mkt");

        when(codexRequestService.find(735L)).thenReturn(completedRequest);
        when(codexRequestService.listBatch(completedRequest)).thenReturn(List.of(completedRequest));
        when(pullRequestService.inspectBranchPublicationReadiness(
            eq("paulofor"),
            eq("ai-hub"),
            eq("main"),
            eq("ai-hub/codex-paulofor-ai-hub-main-chatgpt_codex_mkt")
        )).thenReturn(new PullRequestService.BranchPublicationReadiness(
            List.of("docs/diario/registros1.md"),
            List.of()
        ));

        assertThatThrownBy(() -> controller.createPr(735L, "owner", "codex-ui"))
            .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(ex.getReason()).isEqualTo("Este lote contém apenas o diário obrigatório em docs/diario/registros1.md. Não há alteração funcional para publicar.");
            });

        verify(pullRequestService, never()).createDraftPrFromBranch(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString()
        );
    }
}
