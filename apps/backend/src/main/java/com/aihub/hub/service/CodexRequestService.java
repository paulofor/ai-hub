package com.aihub.hub.service;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.PromptRecord;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ResponseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class CodexRequestService {

    private static final Logger log = LoggerFactory.getLogger(CodexRequestService.class);

    private final CodexRequestRepository codexRequestRepository;
    private final PromptRepository promptRepository;
    private final ResponseRepository responseRepository;
    private final SandboxOrchestratorClient sandboxOrchestratorClient;
    private final TokenCostCalculator tokenCostCalculator;
    private final String defaultModel;
    private final String economyModel;
    private final String defaultBranch;

    public CodexRequestService(CodexRequestRepository codexRequestRepository,
                               PromptRepository promptRepository,
                               ResponseRepository responseRepository,
                               SandboxOrchestratorClient sandboxOrchestratorClient,
                               TokenCostCalculator tokenCostCalculator,
                               @Value("${hub.codex.model:gpt-5-codex}") String defaultModel,
                               @Value("${hub.codex.economy-model:gpt-4.1-mini}") String economyModel,
                               @Value("${hub.codex.default-branch:main}") String defaultBranch) {
        this.codexRequestRepository = codexRequestRepository;
        this.promptRepository = promptRepository;
        this.responseRepository = responseRepository;
        this.sandboxOrchestratorClient = sandboxOrchestratorClient;
        this.tokenCostCalculator = tokenCostCalculator;
        this.defaultModel = defaultModel;
        this.economyModel = economyModel;
        this.defaultBranch = defaultBranch;
    }

    @Transactional
    public CodexRequest create(CreateCodexRequest request) {
        CodexIntegrationProfile profile = resolveProfile(request.getProfile());
        String model = resolveModel(profile, request.getModel());
        log.info("Criando CodexRequest para ambiente {} com modelo {} (perfil {})", request.getEnvironment(), model, profile);
        CodexRequest codexRequest = new CodexRequest(
            request.getEnvironment().trim(),
            model,
            profile,
            request.getPrompt().trim()
        );

        codexRequest.setProfile(profile);
        codexRequest.setPromptTokens(request.getPromptTokens());
        codexRequest.setCachedPromptTokens(request.getCachedPromptTokens());
        codexRequest.setCompletionTokens(request.getCompletionTokens());
        codexRequest.setTotalTokens(request.getTotalTokens());
        codexRequest.setPromptCost(request.getPromptCost());
        codexRequest.setCachedPromptCost(request.getCachedPromptCost());
        codexRequest.setCompletionCost(request.getCompletionCost());
        codexRequest.setCost(request.getCost());

        PromptMetadata metadata = extractMetadata(request.getEnvironment());
        PromptRecord promptRecord = new PromptRecord(
            metadata.repo(),
            metadata.branch(),
            metadata.runId(),
            metadata.prNumber(),
            model,
            request.getPrompt().trim()
        );
        promptRepository.save(promptRecord);

        CodexRequest saved = codexRequestRepository.save(codexRequest);
        log.info("CodexRequest {} salvo, enviando para sandbox se aplicável", saved.getId());
        dispatchToSandbox(saved);
        return saved;
    }

    public List<CodexRequest> list() {
        Instant refreshCutoff = Instant.now().minus(Duration.ofHours(1));
        List<CodexRequest> requests = codexRequestRepository.findAllByOrderByCreatedAtDesc();

        for (CodexRequest request : requests) {
            if (request.getExternalId() == null) {
                continue;
            }

            RefreshDecision decision = evaluateRefresh(request, refreshCutoff);
            if (!decision.shouldRefresh()) {
                continue;
            }

            log.info(
                "Atualizando CodexRequest {} a partir do sandbox ({})",
                request.getId(),
                decision.reason()
            );
            refreshFromSandbox(request);
        }

        return requests;
    }

    private RefreshDecision evaluateRefresh(CodexRequest request, Instant refreshCutoff) {
        boolean hasResponse = StringUtils.hasText(request.getResponseText());
        boolean hasUsageMetadata = request.getPromptTokens() != null
            && request.getCachedPromptTokens() != null
            && request.getCompletionTokens() != null
            && request.getTotalTokens() != null
            && request.getPromptCost() != null
            && request.getCachedPromptCost() != null
            && request.getCompletionCost() != null
            && request.getCost() != null;

        if (hasResponse && hasUsageMetadata) {
            return RefreshDecision.skip();
        }

        if (request.getCreatedAt() == null) {
            return new RefreshDecision(true, "sem data de criação, dados incompletos");
        }

        if (request.getCreatedAt().isAfter(refreshCutoff)) {
            return new RefreshDecision(true, "dentro da janela de atualização automática");
        }

        if (!hasResponse && !hasUsageMetadata) {
            return new RefreshDecision(true, "dados ausentes após janela de atualização");
        }

        if (!hasResponse) {
            return new RefreshDecision(true, "resposta ausente após janela de atualização");
        }

        return new RefreshDecision(true, "metadados de uso ausentes após janela de atualização");
    }

    private CodexIntegrationProfile resolveProfile(CodexIntegrationProfile candidate) {
        return candidate != null ? candidate : CodexIntegrationProfile.STANDARD;
    }

    private String resolveModel(CodexIntegrationProfile profile, String candidate) {
        if (StringUtils.hasText(candidate)) {
            return candidate.trim();
        }
        if (profile == CodexIntegrationProfile.ECONOMY && StringUtils.hasText(economyModel)) {
            return economyModel.trim();
        }
        return defaultModel;
    }

    private PromptMetadata extractMetadata(String environment) {
        RepoCoordinates coordinates = RepoCoordinates.from(environment);
        String repo = coordinates != null
            ? coordinates.owner() + "/" + coordinates.repo()
            : Optional.ofNullable(environment).map(String::trim).filter(value -> !value.isBlank()).orElse("unknown");

        String branch = extractBranch(environment);
        Long runId = extractNumber(environment, "(?i)run[:/#]\\s*(\\d+)");
        Integer prNumber = Optional.ofNullable(extractNumber(environment, "(?i)pr[:/#]\\s*(\\d+)")).map(Long::intValue).orElse(null);

        return new PromptMetadata(repo, branch, runId, prNumber);
    }

    private String extractBranch(String environment) {
        if (!StringUtils.hasText(environment)) {
            return defaultBranch;
        }
        Matcher matcher = Pattern.compile("@([\\w./-]+)").matcher(environment);
        if (matcher.find()) {
            return matcher.group(1).trim();
        }

        String[] parts = environment.trim().split("/");
        if (parts.length >= 3 && StringUtils.hasText(parts[2])) {
            return parts[2].trim();
        }

        return defaultBranch;
    }

    private Long extractNumber(String environment, String pattern) {
        if (!StringUtils.hasText(environment)) {
            return null;
        }
        Matcher matcher = Pattern.compile(pattern).matcher(environment);
        if (matcher.find()) {
            try {
                return Long.parseLong(matcher.group(1));
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private void dispatchToSandbox(CodexRequest request) {
        RepoCoordinates coordinates = RepoCoordinates.from(request.getEnvironment());
        if (coordinates == null) {
            log.info("Ambiente {} não corresponde a um repositório; ignorando envio para o sandbox", request.getEnvironment());
            return;
        }

        String jobId = UUID.randomUUID().toString();
        log.info("Enviando CodexRequest {} para sandbox com jobId {} e branch padrão {}", request.getId(), jobId, defaultBranch);
        PromptMetadata metadata = extractMetadata(request.getEnvironment());

        SandboxJobRequest jobRequest = new SandboxJobRequest(
            jobId,
            coordinates.owner() + "/" + coordinates.repo(),
            null,
            defaultBranch,
            request.getPrompt(),
            null,
            null,
            Optional.ofNullable(request.getProfile()).map(Enum::name).orElse(null),
            request.getModel()
        );

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response = sandboxOrchestratorClient.createJob(jobRequest);
        log.info("Sandbox retornou resposta para CodexRequest {} com jobId {}", request.getId(), response != null ? response.jobId() : jobId);
        String resolvedExternalId = Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::jobId)
            .orElse(jobId);
        request.setExternalId(resolvedExternalId);
        Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::summary)
            .ifPresent(request::setResponseText);
        applyUsageMetadata(request, response);

        codexRequestRepository.save(request);
        log.info("CodexRequest {} atualizado com externalId {}", request.getId(), resolvedExternalId);

        recordResponse(metadata, response);
    }

    private void refreshFromSandbox(CodexRequest request) {
        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
            sandboxOrchestratorClient.getJob(request.getExternalId());
        if (response == null) {
            log.info(
                "Nenhuma resposta encontrada no sandbox para CodexRequest {} com externalId {}",
                request.getId(),
                request.getExternalId()
            );

            boolean updated = false;
            if (!StringUtils.hasText(request.getResponseText())) {
                request.setResponseText(String.format(
                    "Sandbox não encontrou o job %s; os dados podem ter expirado.",
                    request.getExternalId()
                ));
                updated = true;
            }
            if (request.getPromptTokens() == null) {
                request.setPromptTokens(0);
                updated = true;
            }
            if (request.getCachedPromptTokens() == null) {
                request.setCachedPromptTokens(0);
                updated = true;
            }
            if (request.getCompletionTokens() == null) {
                request.setCompletionTokens(0);
                updated = true;
            }
            if (request.getTotalTokens() == null) {
                request.setTotalTokens(0);
                updated = true;
            }
            if (request.getPromptCost() == null) {
                request.setPromptCost(BigDecimal.ZERO);
                updated = true;
            }
            if (request.getCachedPromptCost() == null) {
                request.setCachedPromptCost(BigDecimal.ZERO);
                updated = true;
            }
            if (request.getCompletionCost() == null) {
                request.setCompletionCost(BigDecimal.ZERO);
                updated = true;
            }
            if (request.getCost() == null) {
                request.setCost(BigDecimal.ZERO);
                updated = true;
            }

            if (updated) {
                codexRequestRepository.save(request);
            }

            return;
        }

        boolean updated = false;
        if (response.summary() != null && !response.summary().isBlank()) {
            log.info("Sandbox retornou resumo para CodexRequest {}", request.getId());
            request.setResponseText(response.summary().trim());
            updated = true;
        }
        if (response.error() != null && !response.error().isBlank()) {
            log.info("Sandbox retornou erro para CodexRequest {}", request.getId());
            request.setResponseText(response.error().trim());
            updated = true;
        }

        boolean usageUpdated = applyUsageMetadata(request, response);

        if (updated || usageUpdated) {
            codexRequestRepository.save(request);
            log.info("CodexRequest {} atualizado a partir do sandbox", request.getId());
        }

        recordResponse(extractMetadata(request.getEnvironment()), response);
    }

    private void recordResponse(PromptMetadata metadata, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (response == null) {
            return;
        }

        boolean hasContent = (response.summary() != null && !response.summary().isBlank())
            || (response.patch() != null && !response.patch().isBlank())
            || (response.error() != null && !response.error().isBlank());
        if (!hasContent) {
            return;
        }

        PromptRecord prompt = findPromptRecord(metadata).orElse(null);
        ResponseRecord record = new ResponseRecord(prompt, metadata.repo(), metadata.runId(), metadata.prNumber());
        Optional.ofNullable(response.summary()).filter(value -> !value.isBlank()).ifPresent(record::setFixPlan);
        Optional.ofNullable(response.patch()).filter(value -> !value.isBlank()).ifPresent(record::setUnifiedDiff);
        Optional.ofNullable(response.error()).filter(value -> !value.isBlank()).ifPresent(record::setRootCause);
        responseRepository.save(record);
    }

    private Optional<PromptRecord> findPromptRecord(PromptMetadata metadata) {
        if (metadata == null || metadata.repo() == null) {
            return Optional.empty();
        }

        if (metadata.runId() != null && metadata.prNumber() != null) {
            Optional<PromptRecord> record = promptRepository.findTopByRepoAndRunIdAndPrNumberOrderByCreatedAtDesc(
                metadata.repo(), metadata.runId(), metadata.prNumber()
            );
            if (record.isPresent()) {
                return record;
            }
        }

        if (metadata.runId() != null) {
            Optional<PromptRecord> record = promptRepository.findTopByRepoAndRunIdOrderByCreatedAtDesc(
                metadata.repo(), metadata.runId()
            );
            if (record.isPresent()) {
                return record;
            }
        }

        if (metadata.prNumber() != null) {
            Optional<PromptRecord> record = promptRepository.findTopByRepoAndPrNumberOrderByCreatedAtDesc(
                metadata.repo(), metadata.prNumber()
            );
            if (record.isPresent()) {
                return record;
            }
        }

        return promptRepository.findTopByRepoOrderByCreatedAtDesc(metadata.repo());
    }

    private boolean applyUsageMetadata(
        CodexRequest request,
        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response
    ) {
        if (response == null) {
            return false;
        }

        boolean updated = false;
        Integer promptTokens = response.promptTokens();
        Integer cachedPromptTokens = response.cachedPromptTokens();
        Integer completionTokens = response.completionTokens();
        Integer totalTokens = response.totalTokens();

        if (totalTokens == null) {
            int sum = 0;
            boolean hasAny = false;
            if (promptTokens != null) {
                sum += promptTokens;
                hasAny = true;
            }
            if (cachedPromptTokens != null) {
                sum += cachedPromptTokens;
                hasAny = true;
            }
            if (completionTokens != null) {
                sum += completionTokens;
                hasAny = true;
            }
            if (hasAny) {
                totalTokens = sum;
            }
        }

        TokenCostBreakdown breakdown = tokenCostCalculator.calculate(
            request.getModel(),
            promptTokens,
            cachedPromptTokens,
            completionTokens,
            totalTokens
        );

        if (breakdown != null) {
            if (promptTokens == null) {
                promptTokens = breakdown.inputTokens();
            }
            if (cachedPromptTokens == null) {
                cachedPromptTokens = breakdown.cachedInputTokens();
            }
            if (completionTokens == null) {
                completionTokens = breakdown.outputTokens();
            }
            if (totalTokens == null) {
                totalTokens = breakdown.totalTokens();
            }
        }

        if (!Objects.equals(request.getPromptTokens(), promptTokens)) {
            request.setPromptTokens(promptTokens);
            updated = true;
        }
        if (!Objects.equals(request.getCachedPromptTokens(), cachedPromptTokens)) {
            request.setCachedPromptTokens(cachedPromptTokens);
            updated = true;
        }
        if (!Objects.equals(request.getCompletionTokens(), completionTokens)) {
            request.setCompletionTokens(completionTokens);
            updated = true;
        }
        if (!Objects.equals(request.getTotalTokens(), totalTokens)) {
            request.setTotalTokens(totalTokens);
            updated = true;
        }

        if (breakdown != null) {
            BigDecimal promptCost = breakdown.inputCost();
            BigDecimal cachedPromptCost = breakdown.cachedInputCost();
            BigDecimal completionCost = breakdown.outputCost();
            Integer breakdownTotalTokens = breakdown.totalTokens();

            if (promptCost != null && (request.getPromptCost() == null || promptCost.compareTo(request.getPromptCost()) != 0)) {
                request.setPromptCost(promptCost);
                updated = true;
            }
            if (cachedPromptCost != null && (request.getCachedPromptCost() == null || cachedPromptCost.compareTo(request.getCachedPromptCost()) != 0)) {
                request.setCachedPromptCost(cachedPromptCost);
                updated = true;
            }
            if (completionCost != null && (request.getCompletionCost() == null || completionCost.compareTo(request.getCompletionCost()) != 0)) {
                request.setCompletionCost(completionCost);
                updated = true;
            }
            if (breakdownTotalTokens != null && !Objects.equals(request.getTotalTokens(), breakdownTotalTokens)) {
                request.setTotalTokens(breakdownTotalTokens);
                totalTokens = breakdownTotalTokens;
                updated = true;
            }
        }

        BigDecimal resolvedCost = response.cost();
        if (resolvedCost == null && breakdown != null) {
            resolvedCost = breakdown.totalCost();
        }
        if (resolvedCost != null && (request.getCost() == null || resolvedCost.compareTo(request.getCost()) != 0)) {
            request.setCost(resolvedCost);
            updated = true;
        }

        return updated;
    }

    private record PromptMetadata(String repo, String branch, Long runId, Integer prNumber) {}

    private record RepoCoordinates(String owner, String repo) {
        static RepoCoordinates from(String environment) {
            if (environment == null || environment.isBlank()) {
                return null;
            }
            String[] parts = environment.trim().split("/");
            if (parts.length < 2) {
                return null;
            }
            return new RepoCoordinates(parts[0], parts[1]);
        }
    }

    private record RefreshDecision(boolean shouldRefresh, String reason) {
        private static RefreshDecision skip() {
            return new RefreshDecision(false, "dados completos");
        }
    }
}
