package com.aihub.hub.service;

import com.aihub.hub.config.PublicProxyRecoveryProperties;
import com.aihub.hub.domain.PublicProxyRecovery;
import com.aihub.hub.domain.PublicProxyRecoveryStatus;
import com.aihub.hub.dto.PublicProxyRecoveryRequest;
import com.aihub.hub.dto.PublicProxyRecoveryView;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.PublicProxyRecoveryRepository;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;

@Service
public class PublicProxyRecoveryService {

    public static final String OPERATION = "recover-public-proxy";
    public static final String CONFIRMATION = "RECOVER_PUBLIC_PROXY";

    private static final Logger log = LoggerFactory.getLogger(PublicProxyRecoveryService.class);

    private final PublicProxyRecoveryRepository repository;
    private final PublicProxyRecoveryProperties properties;
    private final GithubApiClient githubApiClient;
    private final AuditService auditService;
    private final Clock clock;
    private final Object submissionLock = new Object();

    public PublicProxyRecoveryService(
        PublicProxyRecoveryRepository repository,
        PublicProxyRecoveryProperties properties,
        GithubApiClient githubApiClient,
        AuditService auditService,
        Clock clock
    ) {
        this.repository = repository;
        this.properties = properties;
        this.githubApiClient = githubApiClient;
        this.auditService = auditService;
        this.clock = clock;
    }

    public Submission submit(PublicProxyRecoveryRequest request) {
        synchronized (submissionLock) {
            return submitLocked(request);
        }
    }

    public PublicProxyRecoveryView refresh(UUID requestId) {
        PublicProxyRecovery recovery = repository.findByRequestId(requestId.toString())
            .orElseThrow(() -> new NoSuchElementException("Recuperação não encontrada"));
        if (recovery.getStatus().isTerminal()) {
            return toView(recovery);
        }

        try {
            JsonNode runs = githubApiClient.listWorkflowRuns(
                properties.repositoryOwner(),
                properties.repositoryName(),
                properties.workflowFile(),
                properties.ref(),
                properties.statusLookupLimit()
            );
            JsonNode matchedRun = findRun(runs, requestId.toString());
            if (matchedRun != null) {
                applyRunStatus(recovery, matchedRun);
            }
        } catch (RuntimeException ex) {
            log.warn("Falha ao consultar execução GitHub da recuperação do proxy requestId={}", requestId, ex);
        }

        return toView(recovery);
    }

    private Submission submitLocked(PublicProxyRecoveryRequest request) {
        requireEnabled();
        String requestId = request.requestId().toString();
        String reason = normalizeReason(request.reason());
        requireConfirmation(request.confirmation());

        PublicProxyRecovery existing = repository.findByRequestId(requestId).orElse(null);
        if (existing != null) {
            if (!existing.getReason().equals(reason)) {
                throw new IllegalStateException("requestId já foi usado com outro motivo");
            }
            return new Submission(toView(existing), false);
        }

        Instant now = clock.instant();
        enforceCooldown(now);
        PersistedRecovery persisted = persistNew(requestId, reason, now);
        PublicProxyRecovery recovery = persisted.recovery();
        if (!persisted.created()) {
            return new Submission(toView(recovery), false);
        }
        audit(recovery, "requested");

        try {
            githubApiClient.dispatchWorkflow(
                properties.repositoryOwner(),
                properties.repositoryName(),
                properties.workflowFile(),
                properties.ref(),
                Map.of(
                    "request_id", requestId,
                    "reason", reason,
                    "confirmation", CONFIRMATION
                )
            );
            recovery.markDispatched(clock.instant());
            recovery = repository.save(recovery);
            audit(recovery, "dispatched");
            return new Submission(toView(recovery), true);
        } catch (RuntimeException ex) {
            recovery.markDispatchFailed(clock.instant());
            repository.save(recovery);
            auditService.record(
                "mcp",
                "public_proxy_recovery_dispatch_failed",
                properties.targetKey() + ":" + requestId,
                Map.of("requestId", requestId, "errorType", ex.getClass().getSimpleName())
            );
            log.error("Falha ao despachar recuperação do proxy requestId={}", requestId, ex);
            throw new PublicProxyRecoveryDispatchException(request.requestId(), ex);
        }
    }

    private PersistedRecovery persistNew(String requestId, String reason, Instant now) {
        try {
            return new PersistedRecovery(
                repository.saveAndFlush(new PublicProxyRecovery(requestId, reason, now)),
                true
            );
        } catch (DataIntegrityViolationException ex) {
            PublicProxyRecovery existing = repository.findByRequestId(requestId).orElseThrow(() -> ex);
            if (!existing.getReason().equals(reason)) {
                throw new IllegalStateException("requestId já foi usado com outro motivo");
            }
            return new PersistedRecovery(existing, false);
        }
    }

    private void requireEnabled() {
        if (!properties.enabled()) {
            throw new IllegalStateException("Recuperação do proxy não está habilitada");
        }
    }

    private void requireConfirmation(String confirmation) {
        if (!CONFIRMATION.equals(confirmation)) {
            throw new IllegalArgumentException("Confirmação literal RECOVER_PUBLIC_PROXY é obrigatória");
        }
    }

    private String normalizeReason(String rawReason) {
        String reason = rawReason == null ? "" : rawReason.trim();
        if (reason.length() < 8 || reason.length() > 500 || reason.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Motivo deve ter entre 8 e 500 caracteres sem controles");
        }
        return reason;
    }

    private void enforceCooldown(Instant now) {
        repository.findTopByOrderByRequestedAtDesc().ifPresent(previous -> {
            long elapsed = Math.max(0, Duration.between(previous.getRequestedAt(), now).getSeconds());
            if (elapsed < properties.cooldownSeconds()) {
                throw new PublicProxyRecoveryCooldownException(properties.cooldownSeconds() - elapsed);
            }
        });
    }

    private JsonNode findRun(JsonNode response, String requestId) {
        if (response == null || !response.path("workflow_runs").isArray()) {
            return null;
        }
        for (JsonNode run : response.path("workflow_runs")) {
            if (run.path("display_title").asText("").contains(requestId)) {
                return run;
            }
        }
        return null;
    }

    private void applyRunStatus(PublicProxyRecovery recovery, JsonNode run) {
        String githubStatus = run.path("status").asText("");
        String conclusion = run.path("conclusion").isNull() ? null : run.path("conclusion").asText(null);
        PublicProxyRecoveryStatus newStatus = mapStatus(githubStatus, conclusion);
        long runId = run.path("id").asLong();
        String runUrl = run.path("html_url").asText(null);

        boolean changed = recovery.getStatus() != newStatus
            || !Objects.equals(recovery.getGithubRunId(), runId)
            || !Objects.equals(recovery.getGithubConclusion(), conclusion);
        if (!changed) {
            return;
        }

        recovery.updateFromGithub(newStatus, runId, runUrl, conclusion, clock.instant());
        repository.save(recovery);
        audit(recovery, newStatus.name().toLowerCase());
    }

    private PublicProxyRecoveryStatus mapStatus(String githubStatus, String conclusion) {
        if ("completed".equals(githubStatus)) {
            return "success".equals(conclusion)
                ? PublicProxyRecoveryStatus.RECOVERED
                : PublicProxyRecoveryStatus.FAILED;
        }
        if ("queued".equals(githubStatus)
            || "waiting".equals(githubStatus)
            || "pending".equals(githubStatus)
            || "requested".equals(githubStatus)) {
            return PublicProxyRecoveryStatus.QUEUED;
        }
        return PublicProxyRecoveryStatus.IN_PROGRESS;
    }

    private void audit(PublicProxyRecovery recovery, String transition) {
        auditService.record(
            "mcp",
            "public_proxy_recovery_" + transition,
            properties.targetKey() + ":" + recovery.getRequestId(),
            Map.of(
                "requestId", recovery.getRequestId(),
                "target", properties.targetKey(),
                "status", recovery.getStatus().name(),
                "reason", recovery.getReason(),
                "githubRunId", recovery.getGithubRunId() == null ? 0L : recovery.getGithubRunId(),
                "githubRunUrl", recovery.getGithubRunUrl() == null ? "" : recovery.getGithubRunUrl(),
                "githubConclusion", recovery.getGithubConclusion() == null ? "" : recovery.getGithubConclusion()
            )
        );
    }

    private PublicProxyRecoveryView toView(PublicProxyRecovery recovery) {
        return new PublicProxyRecoveryView(
            UUID.fromString(recovery.getRequestId()),
            OPERATION,
            properties.targetKey(),
            recovery.getStatus().name(),
            recovery.getReason(),
            recovery.getRequestedAt(),
            recovery.getUpdatedAt(),
            recovery.getGithubRunId(),
            recovery.getGithubRunUrl(),
            recovery.getGithubConclusion()
        );
    }

    public record Submission(PublicProxyRecoveryView view, boolean created) {
    }

    private record PersistedRecovery(PublicProxyRecovery recovery, boolean created) {
    }
}
