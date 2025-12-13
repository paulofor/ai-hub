package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ResponseRepository;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CodexRequestServiceTest {

    private final CodexRequestRepository codexRequestRepository = mock(CodexRequestRepository.class);
    private final PromptRepository promptRepository = mock(PromptRepository.class);
    private final ResponseRepository responseRepository = mock(ResponseRepository.class);
    private final SandboxOrchestratorClient sandboxOrchestratorClient = mock(SandboxOrchestratorClient.class);
    private final TokenCostCalculator tokenCostCalculator = mock(TokenCostCalculator.class);

    @Test
    void listRefreshesRequestsMarkedFailedAfterSandboxNotFoundFallback() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.STANDARD, "fix things");
        request.setExternalId("job-123");
        request.setStatus(CodexRequestStatus.FAILED);
        request.setResponseText("Sandbox não encontrou o job job-123; os dados podem ter expirado.");
        request.setPromptTokens(0);
        request.setCachedPromptTokens(0);
        request.setCompletionTokens(0);
        request.setTotalTokens(0);
        request.setPromptCost(BigDecimal.ZERO);
        request.setCachedPromptCost(BigDecimal.ZERO);
        request.setCompletionCost(BigDecimal.ZERO);
        request.setCost(BigDecimal.ZERO);
        request.setCreatedAt(Instant.now().minus(Duration.ofMinutes(20)));

        when(codexRequestRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(promptRepository.findTopByRepoOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdAndPrNumberOrderByCreatedAtDesc(anyString(), anyLong(), anyInt())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdOrderByCreatedAtDesc(anyString(), anyLong())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndPrNumberOrderByCreatedAtDesc(anyString(), anyInt())).thenReturn(Optional.empty());
        when(responseRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(tokenCostCalculator.calculate(any(), any(), any(), any(), any())).thenReturn(null);

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse orchestratorResponse =
            new SandboxOrchestratorClient.SandboxOrchestratorJobResponse(
                "job-123",
                "COMPLETED",
                "feito",
                Collections.emptyList(),
                null,
                "https://github.com/owner/repo/pull/1",
                null,
                10,
                0,
                20,
                30,
                new BigDecimal("1.23"),
                Instant.now().minusSeconds(120).toString(),
                Instant.now().toString(),
                120_000L,
                0,
                0,
                0
            );
        when(sandboxOrchestratorClient.getJob("job-123")).thenReturn(orchestratorResponse);

        CodexRequestService service = new CodexRequestService(
            codexRequestRepository,
            promptRepository,
            responseRepository,
            sandboxOrchestratorClient,
            tokenCostCalculator,
            "gpt-5-codex",
            "gpt-4.1-mini",
            "main"
        );

        List<CodexRequest> refreshed = service.list();

        assertThat(refreshed).containsExactly(request);
        assertThat(request.getStatus()).isEqualTo(CodexRequestStatus.COMPLETED);
        assertThat(request.getResponseText()).isEqualTo("feito");
        assertThat(request.getPullRequestUrl()).isEqualTo("https://github.com/owner/repo/pull/1");
        verify(sandboxOrchestratorClient).getJob("job-123");
        verify(codexRequestRepository, atLeastOnce()).save(request);
    }
}
