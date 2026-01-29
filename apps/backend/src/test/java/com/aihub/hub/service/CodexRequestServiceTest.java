package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.repository.CodexHttpRequestRepository;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.repository.CodexInteractionRepository;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ResponseRepository;
import org.junit.jupiter.api.BeforeEach;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CodexRequestServiceTest {

    private final CodexRequestRepository codexRequestRepository = mock(CodexRequestRepository.class);
    private final PromptRepository promptRepository = mock(PromptRepository.class);
    private final ResponseRepository responseRepository = mock(ResponseRepository.class);
    private final CodexInteractionRepository codexInteractionRepository = mock(CodexInteractionRepository.class);
    private final CodexHttpRequestRepository codexHttpRequestRepository = mock(CodexHttpRequestRepository.class);
    private final EnvironmentRepository environmentRepository = mock(EnvironmentRepository.class);
    private final SandboxOrchestratorClient sandboxOrchestratorClient = mock(SandboxOrchestratorClient.class);
    private final TokenCostCalculator tokenCostCalculator = mock(TokenCostCalculator.class);

    @BeforeEach
    void setup() {
        when(environmentRepository.findByNameIgnoreCase(anyString())).thenReturn(Optional.empty());
    }

    @Test
    void appliesFallbackAndStopsRefreshingWhenSandboxJobIsMissing() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.STANDARD, "fix things");
        request.setExternalId("job-123");
        request.setStatus(CodexRequestStatus.FAILED);
        request.setCreatedAt(Instant.now().minus(Duration.ofMinutes(20)));

        when(codexRequestRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(request), List.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(promptRepository.findTopByRepoOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdAndPrNumberOrderByCreatedAtDesc(anyString(), anyLong(), anyInt())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdOrderByCreatedAtDesc(anyString(), anyLong())).thenReturn(Optional.empty());
        when(codexInteractionRepository.countByCodexRequestIds(any())).thenReturn(Collections.emptyList());
        when(codexInteractionRepository.countByCodexRequestId(anyLong())).thenReturn(0);
        when(sandboxOrchestratorClient.getJob("job-123")).thenReturn(null);

        CodexRequestService service = new CodexRequestService(
            codexRequestRepository,
            promptRepository,
            responseRepository,
            codexInteractionRepository,
            codexHttpRequestRepository,
            environmentRepository,
            sandboxOrchestratorClient,
            tokenCostCalculator,
            "gpt-5-codex",
            "gpt-4.1-mini",
            "main"
        );

        List<CodexRequest> firstRefresh = service.list();
        assertThat(firstRefresh).containsExactly(request);
        assertThat(request.getResponseText()).contains("Sandbox não encontrou o job job-123");
        assertThat(request.getPromptTokens()).isZero();
        verify(codexRequestRepository).save(request);
        verify(sandboxOrchestratorClient).getJob("job-123");

        List<CodexRequest> secondRefresh = service.list();
        assertThat(secondRefresh).containsExactly(request);
        verify(sandboxOrchestratorClient, times(1)).getJob("job-123");
    }

    @Test
    void doesNotOverrideTerminalRequestWhenSandboxJobIsMissing() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.STANDARD, "fix things");
        request.setExternalId("job-456");
        request.setStatus(CodexRequestStatus.COMPLETED);
        request.setResponseText("feito");
        Instant createdAt = Instant.now().minus(Duration.ofMinutes(30));
        Instant startedAt = createdAt.plusSeconds(30);
        Instant finishedAt = startedAt.plusSeconds(120);
        request.setCreatedAt(createdAt);
        request.setStartedAt(startedAt);
        request.setFinishedAt(finishedAt);
        request.setDurationMs(Duration.between(startedAt, finishedAt).toMillis());
        request.setPromptTokens(10);
        request.setCachedPromptTokens(0);
        request.setCompletionTokens(20);
        request.setTotalTokens(30);
        request.setPromptCost(BigDecimal.ZERO);
        request.setCachedPromptCost(BigDecimal.ZERO);
        request.setCompletionCost(BigDecimal.ZERO);
        request.setCost(BigDecimal.ZERO);

        when(codexRequestRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(promptRepository.findTopByRepoOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdAndPrNumberOrderByCreatedAtDesc(anyString(), anyLong(), anyInt())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdOrderByCreatedAtDesc(anyString(), anyLong())).thenReturn(Optional.empty());
        when(codexInteractionRepository.countByCodexRequestIds(any())).thenReturn(Collections.emptyList());
        when(codexInteractionRepository.countByCodexRequestId(anyLong())).thenReturn(0);
        when(sandboxOrchestratorClient.getJob("job-456")).thenReturn(null);

        CodexRequestService service = new CodexRequestService(
            codexRequestRepository,
            promptRepository,
            responseRepository,
            codexInteractionRepository,
            codexHttpRequestRepository,
            environmentRepository,
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
        assertThat(request.getFinishedAt()).isEqualTo(finishedAt);
        verifyNoInteractions(sandboxOrchestratorClient);
        verify(codexRequestRepository, never()).save(any(CodexRequest.class));
    }

}
