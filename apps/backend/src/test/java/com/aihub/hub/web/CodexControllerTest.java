package com.aihub.hub.web;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.service.CodexRequestService;
import com.aihub.hub.service.PullRequestService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
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

class CodexControllerTest {


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
}
