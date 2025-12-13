package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.PromptRecord;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.dto.RateCodexRequest;
import com.aihub.hub.dto.SaveCodexCommentRequest;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ResponseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
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
        codexRequest.setStatus(CodexRequestStatus.PENDING);
        codexRequest.setPromptTokens(request.getPromptTokens());
        codexRequest.setCachedPromptTokens(request.getCachedPromptTokens());
        codexRequest.setCompletionTokens(request.getCompletionTokens());
        codexRequest.setTotalTokens(request.getTotalTokens());
        codexRequest.setPromptCost(request.getPromptCost());
        codexRequest.setCachedPromptCost(request.getCachedPromptCost());
        codexRequest.setCompletionCost(request.getCompletionCost());
        codexRequest.setCost(request.getCost());
        codexRequest.setTimeoutCount(0);
        codexRequest.setHttpGetCount(0);

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

    @Transactional
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

    @Transactional(readOnly = true)
    public CodexRequest find(Long id) {
        return codexRequestRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Solicitação Codex não encontrada"));
    }

    @Transactional
    public CodexRequest saveComment(Long id, SaveCodexCommentRequest payload) {
        CodexRequest request = find(id);
        String comment = Optional.ofNullable(payload.getComment())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .orElse(null);
        String problemDescription = Optional.ofNullable(payload.getProblemDescription())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .orElse(null);
        String resolutionDifficulty = Optional.ofNullable(payload.getResolutionDifficulty())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .orElse(null);
        request.setUserComment(comment);
        request.setProblemDescription(problemDescription);
        request.setResolutionDifficulty(resolutionDifficulty);
        return codexRequestRepository.save(request);
    }

    private RefreshDecision evaluateRefresh(CodexRequest request, Instant refreshCutoff) {
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        boolean hasResponse = StringUtils.hasText(request.getResponseText());
        boolean hasUsageMetadata = request.getPromptTokens() != null
            && request.getCachedPromptTokens() != null
            && request.getCompletionTokens() != null
            && request.getTotalTokens() != null
            && request.getPromptCost() != null
            && request.getCachedPromptCost() != null
            && request.getCompletionCost() != null
            && request.getCost() != null;

        if (status.isTerminal() && hasResponse && hasUsageMetadata) {
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
            request.setStatus(CodexRequestStatus.FAILED);
            if (!StringUtils.hasText(request.getResponseText())) {
                request.setResponseText("Ambiente informado não corresponde a um repositório Git válido para o sandbox.");
            }
            Instant finishedAt = Instant.now();
            request.setFinishedAt(finishedAt);
            if (request.getStartedAt() == null) {
                request.setStartedAt(Optional.ofNullable(request.getCreatedAt()).orElse(finishedAt));
            }
            request.setDurationMs(Duration.between(request.getStartedAt(), finishedAt).toMillis());
            codexRequestRepository.save(request);
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
        applySandboxMetadata(request, response);
        Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::summary)
            .filter(StringUtils::hasText)
            .ifPresent(summary -> request.setResponseText(summary.trim()));
        Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::error)
            .filter(StringUtils::hasText)
            .ifPresent(error -> request.setResponseText(error.trim()));
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
            if (request.getStatus() != CodexRequestStatus.CANCELLED) {
                request.setStatus(CodexRequestStatus.FAILED);
                updated = true;
            }
            if (request.getFinishedAt() == null) {
                Instant finishedAt = Instant.now();
                request.setFinishedAt(finishedAt);
                if (request.getStartedAt() == null) {
                    request.setStartedAt(Optional.ofNullable(request.getCreatedAt()).orElse(finishedAt));
                }
                request.setDurationMs(Duration.between(request.getStartedAt(), finishedAt).toMillis());
                updated = true;
            }

            if (updated) {
                codexRequestRepository.save(request);
            }

            return;
        }

        boolean updated = applySandboxMetadata(request, response);
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

    @Transactional
    public CodexRequest cancel(Long id) {
        CodexRequest request = codexRequestRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Solicitação Codex não encontrada"));
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        if (status.isTerminal()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Solicitação já foi finalizada");
        }

        if (!StringUtils.hasText(request.getExternalId())) {
            Instant finishedAt = Instant.now();
            request.setStatus(CodexRequestStatus.CANCELLED);
            request.setFinishedAt(finishedAt);
            if (request.getStartedAt() == null) {
                request.setStartedAt(Optional.ofNullable(request.getCreatedAt()).orElse(finishedAt));
            }
            request.setDurationMs(Duration.between(request.getStartedAt(), finishedAt).toMillis());
            return codexRequestRepository.save(request);
        }

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response = sandboxOrchestratorClient.cancelJob(request.getExternalId());
        if (response != null) {
            applySandboxMetadata(request, response);
            if (StringUtils.hasText(response.error())) {
                request.setResponseText(response.error().trim());
            } else if (StringUtils.hasText(response.summary())) {
                request.setResponseText(response.summary().trim());
            }
            applyUsageMetadata(request, response);
        } else {
            Instant finishedAt = Instant.now();
            request.setStatus(CodexRequestStatus.CANCELLED);
            request.setFinishedAt(finishedAt);
            if (request.getStartedAt() == null) {
                request.setStartedAt(Optional.ofNullable(request.getCreatedAt()).orElse(finishedAt));
            }
            request.setDurationMs(Duration.between(request.getStartedAt(), finishedAt).toMillis());
        }

        if (request.getStatus() != null && request.getStatus().isTerminal() && request.getFinishedAt() == null) {
            Instant finishedAt = Instant.now();
            request.setFinishedAt(finishedAt);
            if (request.getStartedAt() == null) {
                request.setStartedAt(Optional.ofNullable(request.getCreatedAt()).orElse(finishedAt));
            }
            request.setDurationMs(Duration.between(request.getStartedAt(), finishedAt).toMillis());
        }

        return codexRequestRepository.save(request);
    }

    @Transactional
    public CodexRequest rate(Long id, RateCodexRequest payload) {
        CodexRequest request = codexRequestRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Solicitação Codex não encontrada"));
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        if (status != CodexRequestStatus.COMPLETED) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Avaliações só são permitidas para solicitações concluídas");
        }
        if (payload.getRating() == null || payload.getRating() < 1 || payload.getRating() > 5) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Rating deve estar entre 1 e 5");
        }
        request.setRating(payload.getRating());
        return codexRequestRepository.save(request);
    }

    private boolean applySandboxMetadata(CodexRequest request, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (response == null) {
            return false;
        }

        boolean updated = false;
        CodexRequestStatus sandboxStatus = CodexRequestStatus.fromSandboxStatus(response.status());
        if (sandboxStatus != null && sandboxStatus != request.getStatus()) {
            request.setStatus(sandboxStatus);
            updated = true;
        }

        Instant startedAt = parseInstant(response.startedAt());
        if (!Objects.equals(request.getStartedAt(), startedAt)) {
            request.setStartedAt(startedAt);
            updated = true;
        }

        Instant finishedAt = parseInstant(response.finishedAt());
        if (!Objects.equals(request.getFinishedAt(), finishedAt)) {
            request.setFinishedAt(finishedAt);
            updated = true;
        }

        Long durationMs = response.durationMs();
        if (durationMs == null && startedAt != null && finishedAt != null) {
            durationMs = Duration.between(startedAt, finishedAt).toMillis();
        }
        if (!Objects.equals(request.getDurationMs(), durationMs)) {
            request.setDurationMs(durationMs);
            updated = true;
        }

        Integer timeoutCount = response.timeoutCount();
        if (timeoutCount != null && !Objects.equals(request.getTimeoutCount(), timeoutCount)) {
            request.setTimeoutCount(timeoutCount);
            updated = true;
        }
        Integer httpGetCount = response.httpGetCount();
        if (httpGetCount != null && !Objects.equals(request.getHttpGetCount(), httpGetCount)) {
            request.setHttpGetCount(httpGetCount);
            updated = true;
        }

        String pullRequestUrl = response.pullRequestUrl();
        if (StringUtils.hasText(pullRequestUrl) && !Objects.equals(request.getPullRequestUrl(), pullRequestUrl.trim())) {
            request.setPullRequestUrl(pullRequestUrl.trim());
            updated = true;
        }

        return updated;
    }

    private Instant parseInstant(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ex) {
            log.warn("Não foi possível converter timestamp do sandbox: {}", value, ex);
            return null;
        }
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
