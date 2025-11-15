package com.aihub.hub.service;

import com.aihub.hub.codex.CodexClient;
import com.aihub.hub.domain.CodexRequestRecord;
import com.aihub.hub.dto.CodexRequestView;
import com.aihub.hub.dto.CodexSubmissionRequest;
import com.aihub.hub.dto.CodexTaskResponse;
import com.aihub.hub.repository.CodexRequestRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CodexServiceTest {

    @Test
    void submitRequestEnsuresSandboxButUsesOriginalSlugForCodex() {
        CodexClient codexClient = mock(CodexClient.class);
        CodexRequestRepository requestRepository = mock(CodexRequestRepository.class);
        PullRequestService pullRequestService = mock(PullRequestService.class);
        SandboxProvisioningService sandboxProvisioningService = mock(SandboxProvisioningService.class);

        CodexService codexService = new CodexService(codexClient, requestRepository, pullRequestService, sandboxProvisioningService);

        CodexSubmissionRequest submissionRequest = new CodexSubmissionRequest("ajuste", "owner/repo");
        String provisionedSlug = "sandbox/owner/repo";
        CodexTaskResponse codexResponse = new CodexTaskResponse("123", "model", "conteudo", List.of());

        when(sandboxProvisioningService.ensureSandbox("owner/repo")).thenReturn(provisionedSlug);
        when(codexClient.submitTask("ajuste", "owner/repo")).thenReturn(codexResponse);
        when(codexClient.getModel()).thenReturn("model");
        when(requestRepository.save(any(CodexRequestRecord.class))).thenAnswer(invocation -> invocation.getArgument(0));

        CodexRequestView view = codexService.submitRequest(submissionRequest);

        verify(sandboxProvisioningService).ensureSandbox("owner/repo");
        verify(codexClient).submitTask("ajuste", "owner/repo");

        ArgumentCaptor<CodexRequestRecord> recordCaptor = ArgumentCaptor.forClass(CodexRequestRecord.class);
        verify(requestRepository).save(recordCaptor.capture());

        CodexRequestRecord savedRecord = recordCaptor.getValue();
        assertThat(savedRecord.getEnvironment()).isEqualTo("owner/repo");
        assertThat(view.environment()).isEqualTo("owner/repo");
    }
}
