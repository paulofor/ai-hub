package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexInteractionRecord;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.github.GithubAppAuth;
import com.aihub.hub.repository.CodexHttpRequestRepository;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.repository.CodexInteractionRepository;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ProblemRepository;
import com.aihub.hub.repository.ResponseRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
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
    private final ProblemRepository problemRepository = mock(ProblemRepository.class);
    private final CodexHttpRequestRepository codexHttpRequestRepository = mock(CodexHttpRequestRepository.class);
    private final EnvironmentRepository environmentRepository = mock(EnvironmentRepository.class);
    private final SandboxOrchestratorClient sandboxOrchestratorClient = mock(SandboxOrchestratorClient.class);
    private final GithubAppAuth githubAppAuth = mock(GithubAppAuth.class);
    private final TokenCostCalculator tokenCostCalculator = mock(TokenCostCalculator.class);
    private final PlatformTransactionManager transactionManager = new PlatformTransactionManager() {
        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
            return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
        }

        @Override
        public void rollback(TransactionStatus status) {
        }
    };

    private CodexRequestService buildService() {
        return buildService(false);
    }

    private CodexRequestService buildService(boolean codexAppServerEnabled) {
        return new CodexRequestService(
            codexRequestRepository,
            promptRepository,
            responseRepository,
            codexInteractionRepository,
            codexHttpRequestRepository,
            environmentRepository,
            problemRepository,
            sandboxOrchestratorClient,
            githubAppAuth,
            tokenCostCalculator,
            new ObjectMapper(),
            transactionManager,
            "gpt-5-codex",
            "gpt-4.1-mini",
            "main",
            1_500_000,
            codexAppServerEnabled,
            null,
            null
        );
    }

    @BeforeEach
    void setup() {
        when(environmentRepository.findByNameIgnoreCase(anyString())).thenReturn(Optional.empty());
        when(githubAppAuth.getInstallationToken()).thenReturn("github-installation-token");
    }

    @Test
    void appliesFallbackAndStopsRefreshingWhenSandboxJobIsMissing() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.STANDARD, "fix things");
        request.setExternalId("job-123");
        request.setStatus(CodexRequestStatus.FAILED);
        request.setCreatedAt(Instant.now().minus(Duration.ofMinutes(20)));

        when(codexRequestRepository.findAllByOrderByCreatedAtDesc()).thenAnswer(invocation -> List.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(promptRepository.findTopByRepoOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdAndPrNumberOrderByCreatedAtDesc(anyString(), anyLong(), anyInt())).thenReturn(Optional.empty());
        when(promptRepository.findTopByRepoAndRunIdOrderByCreatedAtDesc(anyString(), anyLong())).thenReturn(Optional.empty());
        when(codexInteractionRepository.countByCodexRequestIds(any())).thenReturn(Collections.emptyList());
        when(codexInteractionRepository.countByCodexRequestId(anyLong())).thenReturn(0);
        when(sandboxOrchestratorClient.getJob("job-123")).thenReturn(null);

        CodexRequestService service = buildService();

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

        CodexRequestService service = buildService();

        List<CodexRequest> refreshed = service.list();

        assertThat(refreshed).containsExactly(request);
        assertThat(request.getStatus()).isEqualTo(CodexRequestStatus.COMPLETED);
        assertThat(request.getResponseText()).isEqualTo("feito");
        assertThat(request.getFinishedAt()).isEqualTo(finishedAt);
        verifyNoInteractions(sandboxOrchestratorClient);
        verify(codexRequestRepository, never()).save(any(CodexRequest.class));
    }

    @Test
    void listDoesNotRefreshTerminalRequestThatAlreadyHasResponseEvenWhenUsageMetadataIsMissing() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.STANDARD, "fix things");
        request.setExternalId("job-terminal-with-response");
        request.setStatus(CodexRequestStatus.COMPLETED);
        request.setResponseText("feito");
        request.setCreatedAt(Instant.now().minus(Duration.ofMinutes(5)));

        when(codexRequestRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(request));
        when(codexInteractionRepository.countByCodexRequestIds(any())).thenReturn(Collections.emptyList());

        CodexRequestService service = buildService();

        List<CodexRequest> listed = service.list();

        assertThat(listed).containsExactly(request);
        verify(sandboxOrchestratorClient, never()).getJob("job-terminal-with-response");
        verify(codexRequestRepository, never()).save(any(CodexRequest.class));
    }


    @Test
    void findRefreshesStaleRunningRequestWhenDetailIsOpened() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.CHATGPT_CODEX, "continue conversation");
        request.setExternalId("job-detail-missing");
        request.setStatus(CodexRequestStatus.RUNNING);
        request.setCreatedAt(Instant.now().minus(Duration.ofMinutes(30)));

        when(codexRequestRepository.findById(728L)).thenReturn(Optional.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexInteractionRepository.countByCodexRequestId(728L)).thenReturn(2);
        when(sandboxOrchestratorClient.getJob("job-detail-missing")).thenReturn(null);

        CodexRequestService service = buildService(true);

        CodexRequest found = service.find(728L);

        assertThat(found.getStatus()).isEqualTo(CodexRequestStatus.FAILED);
        assertThat(found.getResponseText()).contains("Sandbox não encontrou o job job-detail-missing");
        assertThat(found.getFinishedAt()).isNotNull();
        assertThat(found.getInteractionCount()).isEqualTo(2);
        verify(sandboxOrchestratorClient).getJob("job-detail-missing");
        verify(codexRequestRepository).save(request);
    }

    @Test
    void deletesPendingRequestBeforeDispatch() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "next task");
        request.setStatus(CodexRequestStatus.PENDING);

        when(codexRequestRepository.findById(42L)).thenReturn(Optional.of(request));

        CodexRequestService service = buildService(true);

        service.deletePendingBeforeDispatch(42L);

        verify(codexRequestRepository).delete(request);
    }

    @Test
    void refusesToDeletePendingRequestAlreadyDispatched() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "running task");
        request.setStatus(CodexRequestStatus.PENDING);
        request.setExternalId("job-123");

        when(codexRequestRepository.findById(43L)).thenReturn(Optional.of(request));

        CodexRequestService service = buildService(true);

        assertThatThrownBy(() -> service.deletePendingBeforeDispatch(43L))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("Só é possível apagar solicitações pendentes antes do envio");
        verify(codexRequestRepository, never()).delete(any(CodexRequest.class));
    }

    @Test
    void handleSandboxCallbackUpdatesRequestWhenJobExists() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.STANDARD, "fix things");
        request.setExternalId("job-999");
        request.setCreatedAt(Instant.parse("2024-01-01T00:00:00Z"));

        when(codexRequestRepository.findByExternalId("job-999")).thenReturn(Optional.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(tokenCostCalculator.calculate(any(), any(), any(), any(), any())).thenReturn(
            new TokenCostBreakdown(10, 0, 5, 15, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO)
        );

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
            new SandboxOrchestratorClient.SandboxOrchestratorJobResponse(
                "job-999",
                "COMPLETED",
                null,
                null,
                null,
                "https://example.com/pr/1",
                null,
                10,
                0,
                5,
                15,
                BigDecimal.ZERO,
                "2024-01-01T00:01:00Z",
                "2024-01-01T00:06:00Z",
                300000L,
                1,
                2,
                1,
                0,
                null,
                null,
                null
            );

        CodexRequestService service = buildService();
        boolean updated = service.handleSandboxCallback(response);

        assertThat(updated).isTrue();
        assertThat(request.getStatus()).isEqualTo(CodexRequestStatus.COMPLETED);
        assertThat(request.getFinishedAt()).isEqualTo(Instant.parse("2024-01-01T00:06:00Z"));
        verify(codexRequestRepository).save(request);
    }

    @Test
    void handleSandboxCallbackKeepsSummaryForUserAndPersistsFullOutboundTranscript() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.CHATGPT_CODEX, "verifique esse erro");
        request.setExternalId("job-transcript");
        request.setCreatedAt(Instant.parse("2024-01-01T00:00:00Z"));

        when(codexRequestRepository.findByExternalId("job-transcript")).thenReturn(Optional.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
            new SandboxOrchestratorClient.SandboxOrchestratorJobResponse(
                "job-transcript",
                "COMPLETED",
                "Resumo final menor",
                null,
                null,
                null,
                null,
                10,
                0,
                5,
                15,
                BigDecimal.ZERO,
                "2024-01-01T00:01:00Z",
                "2024-01-01T00:06:00Z",
                300000L,
                0,
                0,
                0,
                0,
                3,
                List.of(
                    new SandboxOrchestratorClient.SandboxOrchestratorJobResponse.Interaction(
                        "in-1",
                        "INBOUND",
                        "verifique esse erro",
                        null,
                        "2024-01-01T00:01:10Z",
                        1
                    ),
                    new SandboxOrchestratorClient.SandboxOrchestratorJobResponse.Interaction(
                        "out-1",
                        "OUTBOUND",
                        "Vou rastrear esse erro pelo fluxo completo.",
                        null,
                        "2024-01-01T00:01:20Z",
                        2
                    ),
                    new SandboxOrchestratorClient.SandboxOrchestratorJobResponse.Interaction(
                        "out-2",
                        "OUTBOUND",
                        "Verifiquei e corrigi a causa-raiz.",
                        null,
                        "2024-01-01T00:06:00Z",
                        3
                    )
                ),
                null
            );

        CodexRequestService service = buildService();
        boolean updated = service.handleSandboxCallback(response);

        assertThat(updated).isTrue();
        assertThat(request.getResponseText()).isEqualTo("Resumo final menor");
        assertThat(request.getModelTranscript())
            .isEqualTo("Vou rastrear esse erro pelo fluxo completo.\n\nVerifiquei e corrigi a causa-raiz.");
        assertThat(request.getInteractionCount()).isEqualTo(3);
        verify(codexRequestRepository).save(request);
        verify(codexInteractionRepository, never()).save(any(CodexInteractionRecord.class));
        verify(codexInteractionRepository, never()).existsBySandboxInteractionId(anyString());
    }

    @Test
    void handleSandboxCallbackUsesExplicitInteractionCountWhenInteractionsAreNotReturned() {
        CodexRequest request = new CodexRequest("owner/repo@main", "gpt-5", CodexIntegrationProfile.CHATGPT_CODEX, "investigue");
        request.setExternalId("job-count-only");
        request.setCreatedAt(Instant.parse("2024-01-01T00:00:00Z"));

        when(codexRequestRepository.findByExternalId("job-count-only")).thenReturn(Optional.of(request));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
            new SandboxOrchestratorClient.SandboxOrchestratorJobResponse(
                "job-count-only",
                "COMPLETED",
                "Concluído",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "2024-01-01T00:01:00Z",
                "2024-01-01T00:06:00Z",
                300000L,
                0,
                0,
                0,
                0,
                42,
                null,
                null
            );

        CodexRequestService service = buildService();
        boolean updated = service.handleSandboxCallback(response);

        assertThat(updated).isTrue();
        assertThat(request.getInteractionCount()).isEqualTo(42);
        verify(codexRequestRepository).save(request);
        verify(codexInteractionRepository, never()).save(any(CodexInteractionRecord.class));
        verify(codexInteractionRepository, never()).existsBySandboxInteractionId(anyString());
    }

    @Test
    void smartEconomyUsesEconomyModelWhenFootprintIsBelowThreshold() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("ajuste simples");
        payload.setProfile(CodexIntegrationProfile.SMART_ECONOMY);
        payload.setTotalTokens(900_000);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-4.1-mini");
        assertThat(created.getVersion()).isEqualTo(CodexRequest.DEFAULT_VERSION);
    }

    @Test
    void smartEconomyFallsBackToStandardModelWhenFootprintExceedsThreshold() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("ajuste complexo");
        payload.setProfile(CodexIntegrationProfile.SMART_ECONOMY);
        payload.setTotalTokens(2_000_000);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-5-codex");
    }


    @Test
    void ecoOneAlwaysUsesEconomyModelWhenAvailable() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo eco-1");
        payload.setProfile(CodexIntegrationProfile.ECO_1);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-4.1-mini");
    }

    @Test
    void ecoTwoAlwaysUsesEconomyModelWhenAvailable() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo eco-2");
        payload.setProfile(CodexIntegrationProfile.ECO_2);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-4.1-mini");
    }

    @Test
    void ecoThreeAlwaysUsesEconomyModelWhenAvailable() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo eco-3");
        payload.setProfile(CodexIntegrationProfile.ECO_3);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-4.1-mini");
    }


    @Test
    void ecoThirtyAlwaysUsesEconomyModelWhenAvailable() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo eco-30 legado");
        payload.setProfile(CodexIntegrationProfile.ECO_30);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-4.1-mini");
    }


    @Test
    void chatgptCodexDoesNotUseOAuthDerivedApiTokenWhileAppServerIsNotIntegrated() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo codex chatgpt");
        payload.setProfile(CodexIntegrationProfile.CHATGPT_CODEX);

        CodexRequest created = service.create(payload);

        assertThat(created.getStatus()).isEqualTo(CodexRequestStatus.FAILED);
        assertThat(created.getResponseText()).contains("Codex App Server");
        verify(sandboxOrchestratorClient, never()).createJob(any());
    }


    @Test
    void chatgptCodexFailsLocallyWhenOAuthTokenIsUnavailable() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo codex chatgpt sem token");
        payload.setProfile(CodexIntegrationProfile.CHATGPT_CODEX);

        CodexRequest created = service.create(payload);

        assertThat(created.getStatus()).isEqualTo(CodexRequestStatus.FAILED);
        assertThat(created.getResponseText()).contains("Codex App Server");
        assertThat(created.getFinishedAt()).isNotNull();
        assertThat(created.getDurationMs()).isNotNull();
        verify(sandboxOrchestratorClient, never()).createJob(any());
    }


    @Test
    void chatgptCodexDispatchesViaAppServerWhenExecutableWithoutOauthToken() {
        CodexRequestService service = buildService(true);
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.readCodexAccount()).thenReturn(Map.of(
            "connected", true,
            "status", "connected",
            "authMode", "chatgpt",
            "executable", true
        ));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo codex chatgpt via app server");
        payload.setProfile(CodexIntegrationProfile.CHATGPT_CODEX);

        CodexRequest created = service.create(payload);

        assertThat(created.getStatus()).isEqualTo(CodexRequestStatus.PENDING);
        verify(sandboxOrchestratorClient).readCodexAccount();
        ArgumentCaptor<SandboxJobRequest> requestCaptor = ArgumentCaptor.forClass(SandboxJobRequest.class);
        verify(sandboxOrchestratorClient).createJob(requestCaptor.capture());
        assertThat(requestCaptor.getValue().accessToken()).isNull();
        assertThat(requestCaptor.getValue().githubToken()).isNull();
    }


    @Test
    void chatgptCodexMktDispatchesViaAppServerWithoutOauthToken() {
        CodexRequestService service = buildService(true);
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.readCodexAccount()).thenReturn(Map.of(
            "connected", true,
            "status", "connected",
            "authMode", "chatgpt",
            "executable", true
        ));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("analise relatorios md de marketing");
        payload.setProfile(CodexIntegrationProfile.CHATGPT_CODEX_MKT);

        CodexRequest created = service.create(payload);

        assertThat(created.getStatus()).isEqualTo(CodexRequestStatus.PENDING);
        ArgumentCaptor<SandboxJobRequest> requestCaptor = ArgumentCaptor.forClass(SandboxJobRequest.class);
        verify(sandboxOrchestratorClient).createJob(requestCaptor.capture());
        assertThat(requestCaptor.getValue().profile()).isEqualTo("CHATGPT_CODEX_MKT");
        assertThat(requestCaptor.getValue().accessToken()).isNull();
        assertThat(requestCaptor.getValue().githubToken()).isNull();
    }


    @Test
    void chatgptCodexUsesEconomyModelWhenAvailable() {
        CodexRequestService service = buildService();
        when(promptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(codexRequestRepository.save(any(CodexRequest.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(any())).thenReturn(null);

        CreateCodexRequest payload = new CreateCodexRequest();
        payload.setEnvironment("owner/repo@main");
        payload.setPrompt("modo codex chatgpt");
        payload.setProfile(CodexIntegrationProfile.CHATGPT_CODEX);

        CodexRequest created = service.create(payload);
        assertThat(created.getModel()).isEqualTo("gpt-4.1-mini");
    }

}
