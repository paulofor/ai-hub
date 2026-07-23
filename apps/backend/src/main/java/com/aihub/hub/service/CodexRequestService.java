package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexDocumentAccessLog;
import com.aihub.hub.domain.CodexInteractionDirection;
import com.aihub.hub.domain.CodexInteractionRecord;
import com.aihub.hub.domain.CodexHttpRequestLog;
import com.aihub.hub.domain.EnvironmentRecord;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.ProblemRecord;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.PromptRecord;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.dto.CodexDashboardMetrics;
import com.aihub.hub.dto.CodexRequestSummary;
import com.aihub.hub.dto.RateCodexRequest;
import com.aihub.hub.dto.SaveCodexCommentRequest;
import com.aihub.hub.dto.UpdatePendingCodexRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.aihub.hub.github.GithubAppAuth;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.CodexDocumentAccessRepository;
import com.aihub.hub.repository.CodexHttpRequestRepository;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.repository.CodexInteractionRepository;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.ProblemRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ResponseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.client.RestClientResponseException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class CodexRequestService {

    private static final Logger log = LoggerFactory.getLogger(CodexRequestService.class);
    private static final Duration SANDBOX_NOT_FOUND_GRACE_PERIOD = Duration.ofMinutes(15);
    private static final Set<Long> SANDBOX_REFRESHES_IN_PROGRESS = ConcurrentHashMap.newKeySet();
    private static final List<CodexRequestStatus> ACTIVE_QUEUE_STATUSES = List.of(CodexRequestStatus.PENDING, CodexRequestStatus.RUNNING);
    private static final int SUMMARY_PROMPT_PREVIEW_LIMIT = 2000;
    private static final int REQUEST_TITLE_LIMIT = 140;
    private static final Pattern JSON_FENCE_PATTERN = Pattern.compile("(?is)```(?:json)?\\s*([\\s\\S]*?)\\s*```");
    private static final Pattern LAST_USER_MESSAGE_PATTERN = Pattern.compile(
        "(?s)(?:^|\\R)Última mensagem do usuário:\\s*\\R?(.+?)\\s*$"
    );

    private final CodexRequestRepository codexRequestRepository;
    private final PromptRepository promptRepository;
    private final ResponseRepository responseRepository;
    private final CodexInteractionRepository codexInteractionRepository;
    private final CodexHttpRequestRepository codexHttpRequestRepository;
    private final CodexDocumentAccessRepository codexDocumentAccessRepository;
    private final EnvironmentRepository environmentRepository;
    private final ProblemRepository problemRepository;
    private final SandboxOrchestratorClient sandboxOrchestratorClient;
    private final GithubAppAuth githubAppAuth;
    private final GithubApiClient githubApiClient;
    private final TokenCostCalculator tokenCostCalculator;
    private final String defaultModel;
    private final String economyModel;
    private final String defaultBranch;
    private final TransactionTemplate sandboxRefreshTemplate;
    private final String sandboxCallbackUrl;
    private final String sandboxCallbackSecret;
    private final ZoneId dashboardZone;
    private Clock dashboardClock;
    private final int smartEconomyEconomyTokenCeiling;
    private final boolean codexAppServerEnabled;
    private final ObjectMapper objectMapper;

    public CodexRequestService(CodexRequestRepository codexRequestRepository,
                               PromptRepository promptRepository,
                               ResponseRepository responseRepository,
                               CodexInteractionRepository codexInteractionRepository,
                               CodexHttpRequestRepository codexHttpRequestRepository,
                               CodexDocumentAccessRepository codexDocumentAccessRepository,
                               EnvironmentRepository environmentRepository,
                               ProblemRepository problemRepository,
                               SandboxOrchestratorClient sandboxOrchestratorClient,
                               GithubAppAuth githubAppAuth,
                               GithubApiClient githubApiClient,
                               TokenCostCalculator tokenCostCalculator,
                               ObjectMapper objectMapper,
                               PlatformTransactionManager transactionManager,
                               @Value("${hub.codex.model:gpt-5-codex}") String defaultModel,
                               @Value("${hub.codex.economy-model:gpt-4.1-mini}") String economyModel,
                               @Value("${hub.codex.default-branch:main}") String defaultBranch,
                               @Value("${hub.codex.smart-economy.max-economy-tokens:1500000}") int smartEconomyEconomyTokenCeiling,
                               @Value("${hub.dashboard.time-zone:America/Sao_Paulo}") String dashboardTimeZone,
                               @Value("${hub.codex.app-server-enabled:false}") boolean codexAppServerEnabled,
                               @Value("${hub.sandbox.callback.url:}") String sandboxCallbackUrl,
                               @Value("${hub.sandbox.callback.secret:}") String sandboxCallbackSecret) {
        this.codexRequestRepository = codexRequestRepository;
        this.promptRepository = promptRepository;
        this.responseRepository = responseRepository;
        this.codexInteractionRepository = codexInteractionRepository;
        this.codexHttpRequestRepository = codexHttpRequestRepository;
        this.codexDocumentAccessRepository = codexDocumentAccessRepository;
        this.environmentRepository = environmentRepository;
        this.problemRepository = problemRepository;
        this.sandboxOrchestratorClient = sandboxOrchestratorClient;
        this.githubAppAuth = githubAppAuth;
        this.githubApiClient = githubApiClient;
        this.tokenCostCalculator = tokenCostCalculator;
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper is required");
        this.defaultModel = defaultModel;
        this.economyModel = economyModel;
        this.defaultBranch = defaultBranch;
        this.sandboxCallbackUrl = StringUtils.hasText(sandboxCallbackUrl) ? sandboxCallbackUrl.trim() : null;
        this.sandboxCallbackSecret = StringUtils.hasText(sandboxCallbackSecret) ? sandboxCallbackSecret.trim() : null;
        this.dashboardZone = ZoneId.of(StringUtils.hasText(dashboardTimeZone) ? dashboardTimeZone.trim() : "America/Sao_Paulo");
        this.dashboardClock = Clock.system(dashboardZone);
        this.smartEconomyEconomyTokenCeiling = smartEconomyEconomyTokenCeiling > 0 ? smartEconomyEconomyTokenCeiling : 1_500_000;
        this.codexAppServerEnabled = codexAppServerEnabled;
        Objects.requireNonNull(transactionManager, "transactionManager is required");
        this.sandboxRefreshTemplate = new TransactionTemplate(transactionManager);
        this.sandboxRefreshTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Transactional
    public CodexRequest create(CreateCodexRequest request) {
        CodexIntegrationProfile profile = resolveProfile(request.getProfile());
        String model = resolveModel(profile, request.getModel(), request);
        String normalizedEnvironment = request.getEnvironment().trim();
        log.info("Criando CodexRequest para ambiente {} com modelo {} (perfil {})", request.getEnvironment(), model, profile);
        CodexRequest codexRequest = new CodexRequest(
            normalizedEnvironment,
            model,
            profile,
            request.getPrompt().trim()
        );

        codexRequest.setProfile(profile);
        codexRequest.setVersion(CodexRequest.DEFAULT_VERSION);
        codexRequest.setStatus(CodexRequestStatus.PENDING);
        codexRequest.setPromptTokens(request.getPromptTokens());
        codexRequest.setCachedPromptTokens(request.getCachedPromptTokens());
        codexRequest.setCompletionTokens(request.getCompletionTokens());
        codexRequest.setTotalTokens(request.getTotalTokens());
        codexRequest.setPromptCost(request.getPromptCost());
        codexRequest.setCachedPromptCost(request.getCachedPromptCost());
        codexRequest.setCompletionCost(request.getCompletionCost());
        codexRequest.setCost(request.getCost());
        ProblemRecord problem = resolveProblemAssociation(request.getProblemId(), normalizedEnvironment);
        if (problem != null) {
            codexRequest.setProblem(problem);
        }
        codexRequest.setTimeoutCount(0);
        codexRequest.setHttpGetCount(0);
        codexRequest.setDbQueryCount(0);
        codexRequest.setImageAttachmentsJson(serializeImageAttachments(request.getImageAttachments()));

        if (!isChatgptCodexSandboxProfile(profile)) {
            PromptMetadata metadata = extractMetadata(request.getEnvironment());
            applyWorkBatch(codexRequest, metadata);
            PromptRecord promptRecord = new PromptRecord(
                metadata.repo(),
                metadata.branch(),
                metadata.runId(),
                metadata.prNumber(),
                model,
                request.getPrompt().trim()
            );
            promptRepository.save(promptRecord);
        }

        CodexRequest saved = saveRequest(codexRequest);
        log.info("CodexRequest {} salvo, avaliando fila de execução", saved.getId());
        saved.setInteractionCount(0);
        if (hasActiveRequest(saved.getProfile())) {
            log.info("CodexRequest {} mantida em fila: já existe execução ativa para o perfil {}", saved.getId(), saved.getProfile());
            return saved;
        }
        dispatchToSandbox(saved, request.getImageAttachments());
        return saved;
    }

    private String serializeImageAttachments(List<CreateCodexRequest.ImageAttachment> imageAttachments) {
        if (imageAttachments == null || imageAttachments.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(imageAttachments);
        } catch (JsonProcessingException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Não foi possível salvar as imagens anexadas da solicitação", ex);
        }
    }

    private List<CreateCodexRequest.ImageAttachment> deserializeImageAttachments(CodexRequest request) {
        if (request == null || !StringUtils.hasText(request.getImageAttachmentsJson())) {
            return List.of();
        }
        try {
            return objectMapper.readValue(request.getImageAttachmentsJson(), new TypeReference<List<CreateCodexRequest.ImageAttachment>>() { });
        } catch (JsonProcessingException ex) {
            log.error("Falha ao ler imagens anexadas da CodexRequest {} em fila", request.getId(), ex);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível recuperar as imagens da solicitação em fila", ex);
        }
    }

    private boolean hasActiveRequest(CodexIntegrationProfile profile) {
        return codexRequestRepository.existsByProfileAndStatusInAndExternalIdIsNotNull(profile, ACTIVE_QUEUE_STATUSES);
    }

    private void dispatchNextQueuedRequest(CodexIntegrationProfile profile) {
        if (profile == null || hasActiveRequest(profile)) {
            return;
        }
        codexRequestRepository.findFirstByProfileAndStatusAndExternalIdIsNullOrderByCreatedAtAsc(profile, CodexRequestStatus.PENDING)
            .ifPresent(next -> {
                log.info("Despachando próxima CodexRequest {} da fila do perfil {}", next.getId(), profile);
                try {
                    dispatchToSandbox(next, deserializeImageAttachments(next));
                } catch (Exception ex) {
                    log.error(
                        "Falha ao despachar próxima CodexRequest {} da fila do perfil {}; a solicitação permanecerá pendente para nova tentativa",
                        next.getId(),
                        profile,
                        ex
                    );
                }
            });
    }

    public Optional<ResponseRecord> findLatestResponseForEnvironment(String environment) {
        PromptMetadata metadata = extractMetadata(environment);
        if (metadata == null || metadata.repo() == null) {
            return Optional.empty();
        }

        if (metadata.runId() != null && metadata.prNumber() != null) {
            Optional<ResponseRecord> record = responseRepository.findTopByRepoAndRunIdAndPrNumberOrderByCreatedAtDesc(
                metadata.repo(), metadata.runId(), metadata.prNumber()
            );
            if (record.isPresent()) {
                return record;
            }
        }

        if (metadata.runId() != null) {
            Optional<ResponseRecord> record = responseRepository.findTopByRepoAndRunIdOrderByCreatedAtDesc(
                metadata.repo(), metadata.runId()
            );
            if (record.isPresent()) {
                return record;
            }
        }

        if (metadata.prNumber() != null) {
            Optional<ResponseRecord> record = responseRepository.findTopByRepoAndPrNumberOrderByCreatedAtDesc(
                metadata.repo(), metadata.prNumber()
            );
            if (record.isPresent()) {
                return record;
            }
        }

        return responseRepository.findTopByRepoOrderByCreatedAtDesc(metadata.repo());
    }

    @Transactional(readOnly = true)
    public List<CodexRequest> list() {
        List<CodexRequest> requests = codexRequestRepository.findAllByOrderByCreatedAtDesc();
        applyInteractionCounts(requests);
        return requests;
    }

    @Transactional(readOnly = true)
    public Page<CodexRequestSummary> listPage(int page, int size, Integer rating) {
        PageRequest pageRequest = PageRequest.of(page, size);
        Page<CodexRequestSummary> summaries = rating == null
            ? codexRequestRepository.findSummariesByOrderByCreatedAtDesc(pageRequest)
            : codexRequestRepository.findSummariesByRatingOrderByCreatedAtDesc(rating, pageRequest);
        return summaries.map(this::prepareRequestSummary);
    }

    @Transactional(readOnly = true)
    public CodexDashboardMetrics dashboardMetrics() {
        ZoneId zone = dashboardZone;
        LocalDate today = LocalDate.now(dashboardClock);
        Instant dayStart = today
            .atStartOfDay(zone)
            .toInstant();
        Instant weekStart = today
            .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            .atStartOfDay(zone)
            .toInstant();
        Instant monthStart = today
            .withDayOfMonth(1)
            .atStartOfDay(zone)
            .toInstant();
        Instant seriesStart = today
            .minusMonths(11)
            .withDayOfMonth(1)
            .atStartOfDay(zone)
            .toInstant();

        return new CodexDashboardMetrics(
            buildMetricWindow(dayStart),
            buildMetricWindow(weekStart),
            buildMetricWindow(monthStart),
            buildMetricSeries(seriesStart, today, zone)
        );
    }

    private CodexDashboardMetrics.CodexDashboardMetricWindow buildMetricWindow(Instant start) {
        Object[] values = codexRequestRepository.summarizeMetricsSince(start);
        if (values != null && values.length == 1 && values[0] instanceof Object[] nested) {
            values = nested;
        }
        return new CodexDashboardMetrics.CodexDashboardMetricWindow(
            start,
            aggregateLong(values, 0),
            aggregateLong(values, 1),
            aggregateLong(values, 2)
        );
    }

    private long aggregateLong(Object[] values, int index) {
        if (values == null || index >= values.length || values[index] == null) {
            return 0L;
        }
        Object value = values[index];
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private CodexDashboardMetrics.CodexDashboardMetricSeries buildMetricSeries(Instant start, LocalDate today, ZoneId zone) {
        LocalDate firstDay = start.atZone(zone).toLocalDate();
        Map<LocalDate, MetricAccumulator> daily = initializeDailyBuckets(firstDay, today);
        Map<LocalDate, MetricAccumulator> weekly = initializeWeeklyBuckets(firstDay, today);
        Map<LocalDate, MetricAccumulator> monthly = initializeMonthlyBuckets(firstDay, today);

        List<Object[]> rows = codexRequestRepository.findMetricRowsSince(start);
        if (rows == null) {
            rows = List.of();
        }
        for (Object[] row : rows) {
            Instant createdAt = aggregateInstant(row, 0);
            if (createdAt == null) {
                continue;
            }
            LocalDate createdDate = createdAt.atZone(zone).toLocalDate();
            long interactions = aggregateLong(row, 1);
            long duration = aggregateLong(row, 2);

            accumulate(daily, createdDate, interactions, duration);
            accumulate(weekly, createdDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), interactions, duration);
            accumulate(monthly, createdDate.withDayOfMonth(1), interactions, duration);
        }

        return new CodexDashboardMetrics.CodexDashboardMetricSeries(
            toMetricWindows(daily, zone),
            toMetricWindows(weekly, zone),
            toMetricWindows(monthly, zone)
        );
    }

    private Map<LocalDate, MetricAccumulator> initializeDailyBuckets(LocalDate start, LocalDate end) {
        Map<LocalDate, MetricAccumulator> buckets = new java.util.TreeMap<>();
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            buckets.put(date, new MetricAccumulator());
        }
        return buckets;
    }

    private Map<LocalDate, MetricAccumulator> initializeWeeklyBuckets(LocalDate start, LocalDate end) {
        Map<LocalDate, MetricAccumulator> buckets = new java.util.TreeMap<>();
        LocalDate firstWeek = start.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate lastWeek = end.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        for (LocalDate date = firstWeek; !date.isAfter(lastWeek); date = date.plusWeeks(1)) {
            buckets.put(date, new MetricAccumulator());
        }
        return buckets;
    }

    private Map<LocalDate, MetricAccumulator> initializeMonthlyBuckets(LocalDate start, LocalDate end) {
        Map<LocalDate, MetricAccumulator> buckets = new java.util.TreeMap<>();
        LocalDate firstMonth = start.withDayOfMonth(1);
        LocalDate lastMonth = end.withDayOfMonth(1);
        for (LocalDate date = firstMonth; !date.isAfter(lastMonth); date = date.plusMonths(1)) {
            buckets.put(date, new MetricAccumulator());
        }
        return buckets;
    }

    private void accumulate(Map<LocalDate, MetricAccumulator> buckets, LocalDate startsAt, long interactions, long durationMs) {
        MetricAccumulator accumulator = buckets.computeIfAbsent(startsAt, ignored -> new MetricAccumulator());
        accumulator.requestCount++;
        accumulator.interactionCount += interactions;
        accumulator.durationMs += durationMs;
    }

    private List<CodexDashboardMetrics.CodexDashboardMetricWindow> toMetricWindows(Map<LocalDate, MetricAccumulator> buckets, ZoneId zone) {
        return buckets.entrySet().stream()
            .map(entry -> new CodexDashboardMetrics.CodexDashboardMetricWindow(
                entry.getKey().atStartOfDay(zone).toInstant(),
                entry.getValue().requestCount,
                entry.getValue().interactionCount,
                entry.getValue().durationMs
            ))
            .toList();
    }

    private Instant aggregateInstant(Object[] values, int index) {
        if (values == null || index >= values.length || values[index] == null) {
            return null;
        }
        Object value = values[index];
        return value instanceof Instant instant ? instant : null;
    }

    private static class MetricAccumulator {
        private long requestCount;
        private long interactionCount;
        private long durationMs;
    }

    private CodexRequestSummary prepareRequestSummary(CodexRequestSummary summary) {
        String fullPrompt = summary.prompt();
        return summary.withPromptAndRequestTitle(
            abbreviate(fullPrompt, SUMMARY_PROMPT_PREVIEW_LIMIT),
            buildRequestTitle(fullPrompt, summary.responseText())
        );
    }

    private String buildRequestTitle(String prompt, String responseText) {
        String structuredTitle = extractMarketingStructuredTitle(responseText);
        if (StringUtils.hasText(structuredTitle)) {
            return abbreviate(normalizeTitle(structuredTitle), REQUEST_TITLE_LIMIT);
        }
        return buildRequestTitle(prompt);
    }

    private String buildRequestTitle(String prompt) {
        if (!StringUtils.hasText(prompt)) {
            return "";
        }

        Matcher matcher = LAST_USER_MESSAGE_PATTERN.matcher(prompt);
        String candidate = matcher.find() ? matcher.group(1) : prompt;
        return abbreviate(normalizeTitle(candidate), REQUEST_TITLE_LIMIT);
    }

    private String extractMarketingStructuredTitle(String content) {
        String candidate = extractJsonObjectCandidate(content);
        if (!StringUtils.hasText(candidate)) {
            return "";
        }
        try {
            JsonNode node = objectMapper.readTree(candidate);
            if (node != null && node.isTextual()) {
                return extractMarketingStructuredTitle(node.asText());
            }
            if (node == null || !node.isObject()) {
                return "";
            }
            for (String key : List.of("titulo", "título", "title")) {
                JsonNode title = node.get(key);
                if (title != null && title.isTextual() && StringUtils.hasText(title.asText())) {
                    return title.asText().trim();
                }
            }
        } catch (JsonProcessingException ignored) {
            return "";
        }
        return "";
    }

    private String extractJsonObjectCandidate(String content) {
        if (!StringUtils.hasText(content)) {
            return "";
        }
        String trimmed = content.trim();
        try {
            JsonNode node = objectMapper.readTree(trimmed);
            if (node != null && node.isTextual()) {
                return extractJsonObjectCandidate(node.asText());
            }
            if (node != null && node.isObject()) {
                return trimmed;
            }
        } catch (JsonProcessingException ignored) {
            // Continue with tolerant extraction for fenced or wrapped model output.
        }

        Matcher fenceMatcher = JSON_FENCE_PATTERN.matcher(trimmed);
        if (fenceMatcher.find()) {
            return extractJsonObjectCandidate(fenceMatcher.group(1));
        }

        int start = trimmed.indexOf('{');
        int end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return trimmed.substring(start, end + 1);
        }
        return "";
    }

    private String normalizeTitle(String value) {
        if (!StringUtils.hasText(value)) {
            return "";
        }
        String normalized = value
            .replaceAll("(?m)^Arquivos anexados pelo usuário foram salvos no repositório temporário\\..*$", "")
            .replaceAll("(?m)^- \\d+\\. .*", "")
            .replaceAll("\\s+", " ")
            .trim();
        return normalized;
    }

    private String abbreviate(String value, int limit) {
        if (value == null || value.length() <= limit) {
            return value;
        }
        return value.substring(0, Math.max(0, limit - 1)).trim() + "…";
    }

    @Transactional(readOnly = true)
    public List<CodexInteractionRecord> listInteractions(Long requestId) {
        findWithoutRefresh(requestId);
        return codexInteractionRepository.findAllByCodexRequestIdOrderBySequenceAscIdAsc(requestId);
    }

    @Transactional(readOnly = true)
    public List<CodexRequest> listBatch(CodexRequest request) {
        if (request == null) {
            return List.of();
        }
        if (!StringUtils.hasText(request.getWorkBatchKey())) {
            return List.of(request);
        }
        List<CodexRequest> requests = codexRequestRepository.findByWorkBatchKeyOrderByCreatedAtAsc(request.getWorkBatchKey());
        if (!StringUtils.hasText(request.getPullRequestUrl())) {
            requests = requests.stream()
                .filter(item -> !isClosedBatchRequest(item))
                .toList();
        }
        applyInteractionCounts(requests);
        return requests;
    }

    @Transactional
    public void markPullRequestCreatedForBatch(CodexRequest request, String pullRequestUrl) {
        if (request == null || !StringUtils.hasText(pullRequestUrl)) {
            return;
        }
        String trimmedUrl = pullRequestUrl.trim();
        if (StringUtils.hasText(request.getWorkBatchKey())) {
            listBatch(request).forEach(item -> {
                item.setPullRequestUrl(trimmedUrl);
                item.setWorkBranch(null);
                item.setWorkBatchKey(null);
                saveRequest(item);
            });
            return;
        }
        request.setPullRequestUrl(trimmedUrl);
        request.setWorkBranch(null);
        request.setWorkBatchKey(null);
        saveRequest(request);
    }

    private boolean isClosedBatchRequest(CodexRequest request) {
        if (request == null) {
            return false;
        }
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        return status == CodexRequestStatus.COMPLETED && StringUtils.hasText(request.getPullRequestUrl());
    }

    @Transactional
    public Map<String, Object> discardBatch(String environment, CodexIntegrationProfile profile, String workBatchKey) {
        if (!StringUtils.hasText(environment)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ambiente é obrigatório para descartar lote");
        }
        if (profile == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Perfil é obrigatório para descartar lote");
        }
        if (!StringUtils.hasText(workBatchKey)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Lote é obrigatório para descartar lote");
        }

        List<CodexRequest> batchRequests = codexRequestRepository.findByWorkBatchKeyOrderByCreatedAtAsc(workBatchKey.trim()).stream()
            .filter(item -> environment.equals(item.getEnvironment()))
            .filter(item -> profile.equals(item.getProfile()))
            .toList();

        RemoteBranchDeletionResult branchDeletion = deleteRemoteWorkBranch(environment, workBatchKey.trim());

        int deleted = 0;
        int cancelled = 0;
        int detached = 0;
        List<CodexRequest> requestsToDetach = new ArrayList<>();
        for (CodexRequest item : batchRequests) {
            CodexRequestStatus status = Optional.ofNullable(item.getStatus()).orElse(CodexRequestStatus.PENDING);
            if (status == CodexRequestStatus.PENDING && !StringUtils.hasText(item.getExternalId())) {
                codexRequestRepository.delete(item);
                deleted++;
                continue;
            }
            if ((status == CodexRequestStatus.PENDING || status == CodexRequestStatus.RUNNING) && StringUtils.hasText(item.getExternalId())) {
                try {
                    cancel(item.getId());
                    cancelled++;
                } catch (ResponseStatusException ex) {
                    throw ex;
                } catch (Exception ex) {
                    throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Falha ao cancelar solicitação do lote no sandbox", ex);
                }
            }
            requestsToDetach.add(item);
        }

        for (CodexRequest item : requestsToDetach) {
            item.setWorkBranch(null);
            item.setWorkBatchKey(null);
            saveRequest(item);
            detached++;
        }

        Map<String, Object> result = new HashMap<>();
        result.put("deleted", deleted);
        result.put("cancelled", cancelled);
        result.put("detached", detached);
        result.put("branchDeleted", branchDeletion.deleted());
        if (StringUtils.hasText(branchDeletion.warning())) {
            result.put("branchDeletionWarning", branchDeletion.warning());
        }
        result.put("total", deleted + detached);
        return result;
    }

    private RemoteBranchDeletionResult deleteRemoteWorkBranch(String environment, String workBranch) {
        RepoCoordinates coordinates = RepoCoordinates.from(environment);
        if (coordinates == null || !StringUtils.hasText(workBranch)) {
            return RemoteBranchDeletionResult.notDeleted(null);
        }
        String branch = workBranch.trim();
        if (!branch.startsWith("ai-hub/") || !isValidWorkBranchName(branch)) {
            log.warn("Branch de lote não será apagada por nome inválido ou fora do namespace AI Hub: {}", branch);
            return RemoteBranchDeletionResult.notDeleted("Branch remota não foi apagada porque o nome é inválido ou está fora do namespace AI Hub.");
        }
        try {
            githubApiClient.deleteBranch(coordinates.owner(), coordinates.repo(), branch);
            log.info("Branch remota do lote apagada em {}/{}: {}", coordinates.owner(), coordinates.repo(), branch);
            return RemoteBranchDeletionResult.deletedBranch();
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == 404) {
                log.info("Branch remota do lote já não existia em {}/{}: {}", coordinates.owner(), coordinates.repo(), branch);
                return RemoteBranchDeletionResult.notDeleted(null);
            }
            log.warn("Falha ao apagar branch remota do lote em {}/{}: {}. O lote local continuará sendo descartado.",
                coordinates.owner(), coordinates.repo(), branch, ex);
            return RemoteBranchDeletionResult.notDeleted("Falha ao apagar a branch remota no GitHub; o lote local foi descartado.");
        }
    }

    private record RemoteBranchDeletionResult(boolean deleted, String warning) {
        static RemoteBranchDeletionResult deletedBranch() {
            return new RemoteBranchDeletionResult(true, null);
        }

        static RemoteBranchDeletionResult notDeleted(String warning) {
            return new RemoteBranchDeletionResult(false, warning);
        }
    }

    private boolean isValidWorkBranchName(String branch) {
        return branch.matches("[A-Za-z0-9._/-]+")
            && !branch.contains("..")
            && !branch.startsWith("/")
            && !branch.endsWith("/")
            && !branch.endsWith(".lock");
    }

    public CodexRequest find(Long id) {
        CodexRequest request = findWithoutRefresh(id);
        if (request.getExternalId() == null) {
            return request;
        }

        RefreshDecision decision = evaluateRefresh(request, Instant.now().minus(Duration.ofHours(1)));
        if (!decision.shouldRefresh()) {
            return request;
        }

        log.info(
            "Atualizando CodexRequest {} a partir do sandbox ao abrir detalhe ({})",
            request.getId(),
            decision.reason()
        );
        boolean updated = refreshFromSandbox(request);
        if (updated) {
            return findWithoutRefresh(id);
        }
        return request;
    }

    @Transactional(readOnly = true)
    private CodexRequest findWithoutRefresh(Long id) {
        CodexRequest request = codexRequestRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Solicitação Codex não encontrada"));
        if (request.getInteractionCount() == null) {
            request.setInteractionCount(codexInteractionRepository.countByCodexRequestId(id));
        }
        List<CodexDocumentAccessRepository.DocumentAccessCount> documentAccessCounts =
            Optional.ofNullable(codexDocumentAccessRepository.countDocumentAccessesByRequestId(id)).orElse(List.of());
        request.setDocumentAccesses(
            documentAccessCounts.stream()
                .map(row -> new CodexRequest.DocumentAccessSummary(row.getDocumentPath(), row.getAccessCount()))
                .toList()
        );
        return request;
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
        String executionLog = Optional.ofNullable(payload.getExecutionLog())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .orElse(null);
        request.setUserComment(comment);
        request.setProblemDescription(problemDescription);
        request.setResolutionDifficulty(resolutionDifficulty);
        request.setExecutionLog(executionLog);
        updateInteractionCount(request);
        return saveRequest(request);
    }

    private SandboxJobRequest.DatabaseConnection resolveDatabase(String environmentName) {
        if (!StringUtils.hasText(environmentName)) {
            return null;
        }

        Optional<EnvironmentRecord> record = environmentRepository.findByNameIgnoreCase(environmentName.trim());
        if (record.isEmpty()) {
            return null;
        }

        EnvironmentRecord environment = record.get();
        if (!StringUtils.hasText(environment.getDbHost())
            || !StringUtils.hasText(environment.getDbName())
            || !StringUtils.hasText(environment.getDbUser())) {
            return null;
        }

        return new SandboxJobRequest.DatabaseConnection(
            environment.getDbHost().trim(),
            environment.getDbPort(),
            environment.getDbName().trim(),
            environment.getDbUser().trim(),
            environment.getDbPassword()
        );
    }


    private RefreshDecision evaluateRefresh(CodexRequest request, Instant refreshCutoff) {
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        boolean hasResponse = StringUtils.hasText(request.getResponseText());
        boolean hasUsageMetadata = hasUsageMetadata(request);

        if (status.isTerminal() && hasResponse) {
            if (hasSandboxNotFoundFallback(request)) {
                return RefreshDecision.skip("sandbox já informou ausência do job");
            }
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

    private boolean hasSandboxNotFoundFallback(CodexRequest request) {
        if (request == null) {
            return false;
        }
        String responseText = request.getResponseText();
        return StringUtils.hasText(responseText)
            && responseText.trim().startsWith("Sandbox não encontrou o job");
    }

    private boolean hasUsageMetadata(CodexRequest request) {
        if (request == null) {
            return false;
        }
        return request.getPromptTokens() != null
            && request.getCachedPromptTokens() != null
            && request.getCompletionTokens() != null
            && request.getTotalTokens() != null
            && request.getPromptCost() != null
            && request.getCachedPromptCost() != null
            && request.getCompletionCost() != null
            && request.getCost() != null;
    }

    private boolean applySandboxNotFoundFallback(CodexRequest request, boolean allowStatusOverride) {
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
        if (allowStatusOverride && request.getStatus() != CodexRequestStatus.CANCELLED) {
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
        } else if (request.getDurationMs() == null && request.getStartedAt() != null) {
            request.setDurationMs(Duration.between(request.getStartedAt(), request.getFinishedAt()).toMillis());
            updated = true;
        }

        return updated;
    }

    private CodexIntegrationProfile resolveProfile(CodexIntegrationProfile candidate) {
        return candidate != null ? candidate : CodexIntegrationProfile.STANDARD;
    }

    private String resolveModel(CodexIntegrationProfile profile, String candidate, CreateCodexRequest request) {
        if (StringUtils.hasText(candidate)) {
            return candidate.trim();
        }
        if (profile == CodexIntegrationProfile.SMART_ECONOMY) {
            boolean preferEconomy = shouldRunSmartEconomyAsEconomy(request);
            if (preferEconomy && StringUtils.hasText(economyModel)) {
                return economyModel.trim();
            }
            return defaultModel;
        }
        if ((profile == CodexIntegrationProfile.ECONOMY
            || profile == CodexIntegrationProfile.ECO_1
            || profile == CodexIntegrationProfile.ECO_2
            || profile == CodexIntegrationProfile.ECO_3
            || profile == CodexIntegrationProfile.ECO_30
            || isChatgptCodexProfile(profile))
            && StringUtils.hasText(economyModel)) {
            return economyModel.trim();
        }
        return defaultModel;
    }

    private boolean shouldRunSmartEconomyAsEconomy(CreateCodexRequest request) {
        if (request == null) {
            return false;
        }
        if (!StringUtils.hasText(economyModel)) {
            return false;
        }
        int footprint = estimateTokenFootprint(request);
        return footprint > 0 && footprint <= smartEconomyEconomyTokenCeiling;
    }

    private int estimateTokenFootprint(CreateCodexRequest request) {
        if (request == null) {
            return 0;
        }
        if (request.getTotalTokens() != null && request.getTotalTokens() > 0) {
            return request.getTotalTokens();
        }
        int aggregate = 0;
        if (request.getPromptTokens() != null && request.getPromptTokens() > 0) {
            aggregate += request.getPromptTokens();
        }
        if (request.getCachedPromptTokens() != null && request.getCachedPromptTokens() > 0) {
            aggregate += request.getCachedPromptTokens();
        }
        if (request.getCompletionTokens() != null && request.getCompletionTokens() > 0) {
            aggregate += request.getCompletionTokens();
        }
        if (aggregate > 0) {
            return aggregate;
        }
        String prompt = request.getPrompt();
        if (StringUtils.hasText(prompt)) {
            return Math.max(1, prompt.trim().length() / 4);
        }
        return 0;
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

    private String buildGroupedWorkBranch(String repoSlug, String baseBranch, CodexIntegrationProfile profile) {
        String normalizedRepoSlug = Optional.ofNullable(repoSlug).orElse("repo").replaceAll("@.*$", "");
        String raw = String.join("-",
            "codex",
            normalizedRepoSlug,
            Optional.ofNullable(baseBranch).orElse(defaultBranch),
            Optional.ofNullable(profile).map(Enum::name).orElse("standard")
        ).toLowerCase();
        String slug = raw.replaceAll("[^a-z0-9._/-]+", "-")
            .replaceAll("/", "-")
            .replaceAll("-+", "-")
            .replaceAll("^-|-$", "");
        if (slug.length() > 80) {
            slug = slug.substring(0, 80).replaceAll("-$", "");
        }
        return "ai-hub/" + slug;
    }

    private void dispatchToSandbox(CodexRequest request) {
        dispatchToSandbox(request, List.of());
    }

    private void dispatchToSandbox(CodexRequest request, List<CreateCodexRequest.ImageAttachment> imageAttachments) {
        boolean chatgptCodexProfile = isChatgptCodexProfile(request.getProfile());
        boolean sandboxOnlyProfile = isChatgptCodexSandboxProfile(request.getProfile());
        RepoCoordinates coordinates = RepoCoordinates.from(request.getEnvironment());
        if (coordinates == null && !sandboxOnlyProfile) {
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
            saveRequest(request);
            return;
        }

        PromptMetadata metadata = extractMetadata(request.getEnvironment());
        if (!sandboxOnlyProfile) {
            applyWorkBatch(request, metadata);
        }
        String baseBranch = StringUtils.hasText(metadata.branch()) ? metadata.branch().trim() : defaultBranch;
        String jobId = UUID.randomUUID().toString();
        log.info("Enviando CodexRequest {} para sandbox com jobId {} e branch base {}", request.getId(), jobId, baseBranch);

        String callbackUrl = this.sandboxCallbackUrl;
        String callbackSecret = callbackUrl != null ? this.sandboxCallbackSecret : null;
        if (chatgptCodexProfile && !ensureChatgptCodexExecutable(request)) {
            return;
        }
        String accessToken = null;
        if (chatgptCodexProfile) {
            log.info("CodexRequest {} será despachada para execução CHATGPT_CODEX via Codex App Server, sem token OAuth no payload", request.getId());
        } else {
            log.info("CodexRequest {} será executado sem sessão OAuth HTTP legada; credenciais de execução pertencem ao sandbox-orchestrator", request.getId());
        }

        String repoSlug = coordinates != null ? coordinates.owner() + "/" + coordinates.repo() : null;
        String workBranch = sandboxOnlyProfile
            ? null
            : StringUtils.hasText(request.getWorkBranch())
                ? request.getWorkBranch().trim()
                : buildGroupedWorkBranch(repoSlug, baseBranch, request.getProfile());
        SandboxJobRequest jobRequest = new SandboxJobRequest(
            jobId,
            repoSlug,
            null,
            baseBranch,
            workBranch,
            request.getPrompt(),
            null,
            null,
            Optional.ofNullable(request.getProfile()).map(Enum::name).orElse(null),
            request.getModel(),
            accessToken,
            chatgptCodexProfile ? null : githubAppAuth.getInstallationToken(),
            sandboxOnlyProfile ? null : resolveDatabase(request.getEnvironment()),
            callbackUrl,
            callbackSecret,
            Optional.ofNullable(imageAttachments)
                .orElse(List.of())
                .stream()
                .map(attachment -> new SandboxJobRequest.ImageAttachment(
                    attachment.name(),
                    attachment.mimeType(),
                    attachment.size(),
                    attachment.dataUrl()
                ))
                .toList(),
            chatgptCodexProfile ? Boolean.FALSE : null
        );

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response = sandboxOrchestratorClient.createJob(jobRequest);
        log.info("Sandbox retornou resposta para CodexRequest {} com jobId {}", request.getId(), response != null ? response.jobId() : jobId);
        String resolvedExternalId = Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::jobId)
            .orElse(jobId);
        request.setExternalId(resolvedExternalId);
        applySandboxMetadata(request, response);
        applySandboxResponseContent(request, response);
        applyUsageMetadata(request, response);
        applyInteractionSummary(request, response);

        saveRequest(request);
        log.info("CodexRequest {} atualizado com externalId {}", request.getId(), resolvedExternalId);

        recordResponse(metadata, response);
        recordHttpRequests(request, response);
        recordDocumentAccesses(request, response);
    }

    private void applyWorkBatch(CodexRequest request, PromptMetadata metadata) {
        if (request == null || metadata == null || !StringUtils.hasText(metadata.repo())) {
            return;
        }
        String baseBranch = StringUtils.hasText(metadata.branch()) ? metadata.branch().trim() : defaultBranch;
        String workBranch = buildGroupedWorkBranch(metadata.repo(), baseBranch, request.getProfile());
        request.setWorkBranch(workBranch);
        request.setWorkBatchKey(workBranch);
    }

    private boolean ensureChatgptCodexExecutable(CodexRequest request) {
        if (!codexAppServerEnabled) {
            freezeChatgptCodexUntilAppServer(request);
            return false;
        }
        Map<String, Object> accountState;
        try {
            accountState = sandboxOrchestratorClient.readCodexAccount();
        } catch (Exception ex) {
            log.warn("CodexRequest {} bloqueada: falha ao consultar account/read do Codex App Server: {}", request.getId(), ex.getMessage());
            failChatgptCodexWithoutToken(request, "CODEX_APP_SERVER_UNAVAILABLE");
            return false;
        }
        Object executable = accountState == null ? null : accountState.get("executable");
        if (Boolean.TRUE.equals(executable)) {
            return true;
        }
        String blockReason = accountState != null && accountState.get("blockReason") instanceof String text && StringUtils.hasText(text)
            ? text.trim()
            : "CODEX_NOT_AUTHENTICATED";
        log.warn("CodexRequest {} bloqueada por pré-condição CHATGPT_CODEX não executável: {}", request.getId(), blockReason);
        failChatgptCodexWithoutToken(request, blockReason);
        return false;
    }

    private void freezeChatgptCodexUntilAppServer(CodexRequest request) {
        String reason = codexAppServerEnabled
            ? "CODEX_APP_SERVER_NOT_IMPLEMENTED"
            : "CODEX_APP_SERVER_DISABLED";
        log.warn(
            "CodexRequest {} com perfil CHATGPT_CODEX bloqueada por {}. "
                + "Fluxo OAuth/token exchange manual permanece congelado até a integração com Codex App Server.",
            request.getId(),
            reason
        );
        failChatgptCodexWithoutToken(
            request,
            "O perfil CHATGPT_CODEX está congelado até a integração com o Codex App Server. "
                + "CODEX_APP_SERVER_ENABLED=" + codexAppServerEnabled + ". "
                + "Nenhum token OAuth manual será trocado ou enviado ao sandbox."
        );
    }

    private void failChatgptCodexWithoutToken(CodexRequest request, String blockReason) {
        String message = "Conta ChatGPT conectada não gerou token de execução para o Codex. "
            + "Reconecte a conta ChatGPT e tente novamente; se persistir, verifique a organização configurada para o OAuth.";
        if (StringUtils.hasText(blockReason)) {
            message = message + " Detalhe: " + blockReason.trim();
        }
        request.setStatus(CodexRequestStatus.FAILED);
        request.setResponseText(message);
        Instant finishedAt = Instant.now();
        request.setFinishedAt(finishedAt);
        if (request.getStartedAt() == null) {
            request.setStartedAt(Optional.ofNullable(request.getCreatedAt()).orElse(finishedAt));
        }
        request.setDurationMs(Duration.between(request.getStartedAt(), finishedAt).toMillis());
        request.setCost(BigDecimal.ZERO);
        request.setPromptTokens(Optional.ofNullable(request.getPromptTokens()).orElse(0));
        request.setCachedPromptTokens(Optional.ofNullable(request.getCachedPromptTokens()).orElse(0));
        request.setCompletionTokens(Optional.ofNullable(request.getCompletionTokens()).orElse(0));
        request.setTotalTokens(Optional.ofNullable(request.getTotalTokens()).orElse(0));
        saveRequest(request);
    }

    private boolean isChatgptCodexProfile(CodexIntegrationProfile profile) {
        return profile == CodexIntegrationProfile.CHATGPT_CODEX
            || profile == CodexIntegrationProfile.CHATGPT_CODEX_MKT
            || profile == CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX;
    }

    private boolean isChatgptCodexSandboxProfile(CodexIntegrationProfile profile) {
        return profile == CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX;
    }


    @Transactional
    public boolean handleSandboxCallback(SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (response == null || !StringUtils.hasText(response.jobId())) {
            log.warn("Callback do sandbox ignorado: payload sem jobId");
            return false;
        }

        String jobId = response.jobId().trim();
        Optional<CodexRequest> optional = codexRequestRepository.findByExternalId(jobId);
        if (optional.isEmpty()) {
            log.warn("Callback do sandbox ignorado: nenhum CodexRequest com externalId {}", jobId);
            return false;
        }

        CodexRequest managed = optional.get();
        if (managed.getId() != null && !SANDBOX_REFRESHES_IN_PROGRESS.add(managed.getId())) {
            log.info("Callback do sandbox para CodexRequest {} ignorado temporariamente: já existe sincronização em andamento", managed.getId());
            return false;
        }

        try {
            boolean updated = synchronizeRequestWithSandbox(managed, response);
            if (updated) {
                log.info("CodexRequest {} atualizado via callback do sandbox", managed.getId());
            } else {
                log.info("Callback do sandbox recebido para CodexRequest {} sem alterações", managed.getId());
            }
            if (Optional.ofNullable(managed.getStatus()).orElse(CodexRequestStatus.PENDING).isTerminal()) {
                dispatchNextQueuedRequest(managed.getProfile());
            }
            return updated;
        } finally {
            if (managed.getId() != null) {
                SANDBOX_REFRESHES_IN_PROGRESS.remove(managed.getId());
            }
        }
    }

    private boolean refreshFromSandbox(CodexRequest request) {
        if (request.getId() == null) {
            SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
                sandboxOrchestratorClient.getJob(request.getExternalId());
            return synchronizeRequestWithSandbox(request, response);
        }

        if (!SANDBOX_REFRESHES_IN_PROGRESS.add(request.getId())) {
            log.info("Atualização do CodexRequest {} ignorada: já existe refresh em andamento", request.getId());
            return false;
        }

        AtomicBoolean updated = new AtomicBoolean(false);
        try {
            SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
                sandboxOrchestratorClient.getJob(request.getExternalId());
            sandboxRefreshTemplate.executeWithoutResult(status ->
                codexRequestRepository.findById(request.getId()).ifPresent(managed -> {
                    boolean changed = synchronizeRequestWithSandbox(managed, response);
                    if (changed) {
                        updated.set(true);
                    }
                })
            );
        } catch (Exception ex) {
            log.error("Falha ao atualizar CodexRequest {} a partir do sandbox", request.getId(), ex);
        } finally {
            SANDBOX_REFRESHES_IN_PROGRESS.remove(request.getId());
        }
        return updated.get();
    }

    private boolean synchronizeRequestWithSandbox(CodexRequest request, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (request == null || !StringUtils.hasText(request.getExternalId())) {
            return false;
        }

        if (response == null) {
            return handleMissingSandboxResponse(request);
        }

        boolean updated = applySandboxMetadata(request, response);
        if (applySandboxResponseContent(request, response)) {
            log.info("Sandbox retornou conteúdo de resposta para CodexRequest {}", request.getId());
            updated = true;
        }

        boolean usageUpdated = applyUsageMetadata(request, response);
        boolean interactionSummaryUpdated = applyInteractionSummary(request, response);

        if (updated || usageUpdated || interactionSummaryUpdated) {
            saveRequest(request);
            log.info("CodexRequest {} atualizado a partir do sandbox", request.getId());
        }

        if (Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING).isTerminal()) {
            dispatchNextQueuedRequest(request.getProfile());
        }

        recordResponse(extractMetadata(request.getEnvironment()), response);
        recordHttpRequests(request, response);
        recordDocumentAccesses(request, response);

        return updated || usageUpdated || interactionSummaryUpdated;
    }

    private boolean handleMissingSandboxResponse(CodexRequest request) {
        CodexRequestStatus currentStatus = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        Instant referenceInstant = Optional.ofNullable(request.getStartedAt())
            .orElseGet(() -> Optional.ofNullable(request.getCreatedAt()).orElse(null));
        boolean withinGracePeriod = referenceInstant == null
            || referenceInstant.isAfter(Instant.now().minus(SANDBOX_NOT_FOUND_GRACE_PERIOD));

        if (withinGracePeriod) {
            log.warn(
                "Sandbox ainda não encontrou o job {} (status atual: {}); mantendo estado e tentando novamente dentro do período de tolerância",
                request.getExternalId(),
                currentStatus
            );
            return false;
        }

        boolean hasResponseText = StringUtils.hasText(request.getResponseText());
        boolean missingCriticalData = !hasResponseText
            || !hasUsageMetadata(request)
            || request.getFinishedAt() == null
            || (request.getDurationMs() == null && request.getStartedAt() != null);

        if (!missingCriticalData) {
            log.warn(
                "Sandbox não encontrou o job {}, mas a solicitação já está finalizada com status {}. Mantendo dados atuais.",
                request.getExternalId(),
                currentStatus
            );
            return false;
        }

        log.info(
            "Nenhuma resposta encontrada no sandbox para CodexRequest {} com externalId {}",
            request.getId(),
            request.getExternalId()
        );

        boolean updated = applySandboxNotFoundFallback(request, !currentStatus.isTerminal());
        if (updated) {
            saveRequest(request);
        }

        return updated;
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
            CodexRequest saved = saveRequest(request);
            updateInteractionCount(saved);
            return saved;
        }

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response = sandboxOrchestratorClient.cancelJob(request.getExternalId());
        if (response != null) {
            applySandboxMetadata(request, response);
            applySandboxResponseContent(request, response);
            applyUsageMetadata(request, response);
            applyInteractionSummary(request, response);
            recordHttpRequests(request, response);
            recordDocumentAccesses(request, response);
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

        CodexRequest saved = saveRequest(request);
        updateInteractionCount(saved);
        return saved;
    }

    @Transactional
    public CodexRequest updatePendingBeforeDispatch(Long id, UpdatePendingCodexRequest payload) {
        CodexRequest request = codexRequestRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Solicitação Codex não encontrada"));
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        if (status != CodexRequestStatus.PENDING || StringUtils.hasText(request.getExternalId())) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Só é possível editar solicitações pendentes antes do envio"
            );
        }
        request.setPrompt(payload.getPrompt().trim());
        return saveRequest(request);
    }

    @Transactional
    public void deletePendingBeforeDispatch(Long id) {
        CodexRequest request = codexRequestRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Solicitação Codex não encontrada"));
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        if (status != CodexRequestStatus.PENDING || StringUtils.hasText(request.getExternalId())) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Só é possível apagar solicitações pendentes antes do envio"
            );
        }
        codexRequestRepository.delete(request);
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
        updateInteractionCount(request);
        return saveRequest(request);
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
        Integer httpGetSuccessCount = response.httpGetSuccessCount();
        if (httpGetSuccessCount != null && !Objects.equals(request.getHttpGetSuccessCount(), httpGetSuccessCount)) {
            request.setHttpGetSuccessCount(httpGetSuccessCount);
            updated = true;
        }

        Integer dbQueryCount = response.dbQueryCount();
        if (dbQueryCount != null && !Objects.equals(request.getDbQueryCount(), dbQueryCount)) {
            request.setDbQueryCount(dbQueryCount);
            updated = true;
        }

        String pullRequestUrl = response.pullRequestUrl();
        if (StringUtils.hasText(pullRequestUrl) && !Objects.equals(request.getPullRequestUrl(), pullRequestUrl.trim())) {
            request.setPullRequestUrl(pullRequestUrl.trim());
            updated = true;
        }

        return updated;
    }

    private boolean applySandboxResponseContent(CodexRequest request, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (request == null || response == null) {
            return false;
        }

        boolean updated = false;
        Optional<String> responseText = resolveUserFacingResponseTextFromSandbox(response);
        if (responseText.isPresent() && !Objects.equals(request.getResponseText(), responseText.get())) {
            request.setResponseText(responseText.get());
            updated = true;
        }

        String transcript = buildOutboundInteractionTranscript(response.interactions());
        if (StringUtils.hasText(transcript) && !Objects.equals(request.getModelTranscript(), transcript)) {
            request.setModelTranscript(transcript);
            updated = true;
        }

        return updated;
    }

    private Optional<String> resolveUserFacingResponseTextFromSandbox(SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (response == null) {
            return Optional.empty();
        }

        if (StringUtils.hasText(response.error())) {
            return Optional.of(response.error().trim());
        }

        if (StringUtils.hasText(response.summary())) {
            return Optional.of(response.summary().trim());
        }

        return Optional.empty();
    }

    private String buildOutboundInteractionTranscript(List<SandboxOrchestratorClient.SandboxOrchestratorJobResponse.Interaction> interactions) {
        if (interactions == null || interactions.isEmpty()) {
            return null;
        }

        List<String> chunks = interactions.stream()
            .filter(Objects::nonNull)
            .filter(interaction -> CodexInteractionDirection.fromSandboxValue(interaction.direction()) == CodexInteractionDirection.OUTBOUND)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse.Interaction::content)
            .filter(StringUtils::hasText)
            .map(String::trim)
            .toList();

        if (chunks.isEmpty()) {
            return null;
        }

        return String.join("\n\n", chunks);
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

    private CodexRequest saveRequest(CodexRequest request) {
        updateProblemCostAggregation(request);
        return codexRequestRepository.save(request);
    }

    private void updateProblemCostAggregation(CodexRequest request) {
        if (request == null) {
            return;
        }
        ProblemRecord problem = request.getProblem();
        if (problem == null || problem.getId() == null) {
            return;
        }
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        if (!status.isTerminal()) {
            return;
        }
        BigDecimal resolvedCost = Optional.ofNullable(request.getCost()).orElse(BigDecimal.ZERO);
        if (resolvedCost.compareTo(BigDecimal.ZERO) < 0) {
            resolvedCost = BigDecimal.ZERO;
        }
        final BigDecimal currentCost = resolvedCost;
        final BigDecimal appliedCost = Optional.ofNullable(request.getProblemCostContribution()).orElse(BigDecimal.ZERO);
        if (currentCost.compareTo(appliedCost) == 0) {
            return;
        }
        boolean updatedProblem = problemRepository.findById(problem.getId()).map(managed -> {
            BigDecimal totalCost = Optional.ofNullable(managed.getTotalCost()).orElse(BigDecimal.ZERO);
            BigDecimal nextTotal = totalCost.add(currentCost.subtract(appliedCost));
            if (nextTotal.compareTo(BigDecimal.ZERO) < 0) {
                nextTotal = BigDecimal.ZERO;
            }
            managed.setTotalCost(nextTotal);
            problemRepository.save(managed);
            request.setProblemCostContribution(currentCost);
            return true;
        }).orElse(false);
        if (!updatedProblem) {
            log.warn("Não foi possível atualizar o custo do problema {} para a solicitação {}", problem.getId(), request.getId());
            request.setProblemCostContribution(currentCost);
        }
    }

    private ProblemRecord resolveProblemAssociation(Long problemId, String environmentName) {
        if (problemId == null) {
            return null;
        }
        ProblemRecord problem = problemRepository.findById(problemId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Problema selecionado não existe"));
        if (problem.getFinalizedAt() != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Problema selecionado já foi finalizado");
        }
        EnvironmentRecord problemEnvironment = problem.getEnvironment();
        if (problemEnvironment == null || !StringUtils.hasText(problemEnvironment.getName())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Problema selecionado não está vinculado a um ambiente");
        }
        if (!StringUtils.hasText(environmentName) || !problemEnvironment.getName().equalsIgnoreCase(environmentName.trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Problema selecionado não pertence ao ambiente informado");
        }
        return problem;
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
            String repo = parts[1];
            int branchSeparator = repo.indexOf('@');
            if (branchSeparator >= 0) {
                repo = repo.substring(0, branchSeparator);
            }
            if (!StringUtils.hasText(parts[0]) || !StringUtils.hasText(repo)) {
                return null;
            }
            return new RepoCoordinates(parts[0], repo);
        }
    }

    private record RefreshDecision(boolean shouldRefresh, String reason) {
        private static RefreshDecision skip() {
            return new RefreshDecision(false, "dados completos");
        }

        private static RefreshDecision skip(String reason) {
            return new RefreshDecision(false, reason);
        }
    }

    private void recordHttpRequests(CodexRequest request, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (request == null || request.getId() == null || response == null || response.httpRequests() == null) {
            return;
        }

        String sandboxJobId = Optional.ofNullable(response.jobId()).orElse(request.getExternalId());
        if (!StringUtils.hasText(sandboxJobId)) {
            sandboxJobId = "unknown-" + request.getId();
        }

        for (SandboxOrchestratorClient.SandboxOrchestratorJobResponse.HttpRequest httpRequest : response.httpRequests()) {
            if (httpRequest == null || !StringUtils.hasText(httpRequest.url())) {
                continue;
            }

            String callId = Optional.ofNullable(httpRequest.callId())
                .map(String::trim)
                .filter(StringUtils::hasText)
                .orElse(buildSyntheticCallId(httpRequest, sandboxJobId));
            if (codexHttpRequestRepository.existsBySandboxJobIdAndSandboxCallId(sandboxJobId, callId)) {
                continue;
            }

            Instant requestedAt = parseInstant(httpRequest.requestedAt());
            CodexHttpRequestLog logRecord = new CodexHttpRequestLog(
                request,
                sandboxJobId,
                callId,
                httpRequest.url().trim(),
                httpRequest.status(),
                httpRequest.success(),
                httpRequest.toolName(),
                requestedAt
            );
            codexHttpRequestRepository.save(logRecord);
        }
    }

    private String buildSyntheticCallId(SandboxOrchestratorClient.SandboxOrchestratorJobResponse.HttpRequest httpRequest, String sandboxJobId) {
        String seed = sandboxJobId + "|" + Optional.ofNullable(httpRequest.url()).orElse("") + "|" + Optional.ofNullable(httpRequest.requestedAt()).orElse("");
        return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private void recordDocumentAccesses(CodexRequest request, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (request == null || request.getId() == null || response == null || response.documentAccesses() == null) {
            return;
        }

        String sandboxJobId = Optional.ofNullable(response.jobId()).orElse(request.getExternalId());
        if (!StringUtils.hasText(sandboxJobId)) {
            sandboxJobId = "unknown-" + request.getId();
        }

        for (SandboxOrchestratorClient.SandboxOrchestratorJobResponse.DocumentAccess documentAccess : response.documentAccesses()) {
            if (documentAccess == null || !StringUtils.hasText(documentAccess.documentPath())) {
                continue;
            }

            String accessId = Optional.ofNullable(documentAccess.accessId())
                .map(String::trim)
                .filter(StringUtils::hasText)
                .orElse(buildSyntheticDocumentAccessId(documentAccess, sandboxJobId));
            if (codexDocumentAccessRepository.existsBySandboxJobIdAndSandboxAccessId(sandboxJobId, accessId)) {
                continue;
            }

            CodexDocumentAccessLog logRecord = new CodexDocumentAccessLog(
                request,
                sandboxJobId,
                accessId,
                truncateForColumn(documentAccess.documentPath(), 2048),
                Optional.ofNullable(truncateForColumn(documentAccess.toolName(), 64)).orElse("unknown"),
                truncateForColumn(documentAccess.requestedPath(), 2048),
                truncateForColumn(documentAccess.command(), 4096),
                parseInstant(documentAccess.accessedAt())
            );
            codexDocumentAccessRepository.save(logRecord);
        }
    }

    private String buildSyntheticDocumentAccessId(SandboxOrchestratorClient.SandboxOrchestratorJobResponse.DocumentAccess documentAccess, String sandboxJobId) {
        String seed = sandboxJobId
            + "|" + Optional.ofNullable(documentAccess.documentPath()).orElse("")
            + "|" + Optional.ofNullable(documentAccess.toolName()).orElse("")
            + "|" + Optional.ofNullable(documentAccess.accessedAt()).orElse("");
        return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private String truncateForColumn(String value, int maxLength) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() <= maxLength ? trimmed : trimmed.substring(0, maxLength);
    }

    private boolean applyInteractionSummary(CodexRequest request, SandboxOrchestratorClient.SandboxOrchestratorJobResponse response) {
        if (request == null || response == null) {
            return false;
        }
        Integer responseInteractionCount = response.interactionCount();
        if (responseInteractionCount == null && response.interactions() != null) {
            responseInteractionCount = response.interactions().size();
        }
        if (responseInteractionCount == null) {
            return false;
        }
        int interactionCount = responseInteractionCount;
        Integer currentInteractionCount = request.getInteractionCount();
        if (currentInteractionCount != null && currentInteractionCount > interactionCount) {
            return false;
        }
        if (Objects.equals(currentInteractionCount, interactionCount)) {
            return false;
        }
        request.setInteractionCount(interactionCount);
        return true;
    }

    private void updateInteractionCount(CodexRequest request) {
        if (request == null || request.getInteractionCount() != null || request.getId() == null) {
            return;
        }
        request.setInteractionCount(codexInteractionRepository.countByCodexRequestId(request.getId()));
    }

    private void applyInteractionCounts(List<CodexRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            return;
        }

        List<Long> ids = new ArrayList<>();
        for (CodexRequest request : requests) {
            if (request.getInteractionCount() != null) {
                continue;
            }
            if (request.getId() != null) {
                ids.add(request.getId());
            } else {
                request.setInteractionCount(0);
            }
        }

        if (ids.isEmpty()) {
            return;
        }

        Map<Long, Integer> counts = new HashMap<>();
        for (Object[] row : codexInteractionRepository.countByCodexRequestIds(ids)) {
            if (row == null || row.length < 2) {
                continue;
            }
            Long requestId = null;
            if (row[0] instanceof Number) {
                requestId = ((Number) row[0]).longValue();
            } else if (row[0] instanceof String) {
                try {
                    requestId = Long.parseLong(((String) row[0]).trim());
                } catch (NumberFormatException ignored) {
                    requestId = null;
                }
            }
            Number total = row[1] instanceof Number ? (Number) row[1] : null;
            if (requestId != null) {
                counts.put(requestId, total != null ? total.intValue() : 0);
            }
        }

        for (CodexRequest request : requests) {
            Long requestId = request.getId();
            if (request.getInteractionCount() != null || requestId == null) {
                continue;
            }
            request.setInteractionCount(counts.getOrDefault(requestId, 0));
        }
    }

}
