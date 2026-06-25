package com.aihub.hub.web;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.service.CodexRequestService;
import com.aihub.hub.service.PullRequestService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CodexControllerTest {

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
}
