package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequestStatus;

import java.math.BigDecimal;
import java.time.Instant;

public record CodexRequestSummary(
    Long id,
    String environment,
    String model,
    String version,
    CodexIntegrationProfile profile,
    String prompt,
    CodexRequestStatus status,
    Integer rating,
    String externalId,
    String pullRequestUrl,
    String workBranch,
    String workBatchKey,
    Integer promptTokens,
    Integer cachedPromptTokens,
    Integer completionTokens,
    Integer totalTokens,
    BigDecimal promptCost,
    BigDecimal cachedPromptCost,
    BigDecimal completionCost,
    BigDecimal cost,
    Integer timeoutCount,
    Integer httpGetCount,
    Integer httpGetSuccessCount,
    Integer dbQueryCount,
    Instant startedAt,
    Instant finishedAt,
    Long durationMs,
    Instant createdAt,
    Integer interactionCount,
    Long problemId,
    String problemTitle,
    String requestTitle
) {
    public CodexRequestSummary withPromptAndRequestTitle(String prompt, String requestTitle) {
        return new CodexRequestSummary(
            id, environment, model, version, profile, prompt, status, rating, externalId, pullRequestUrl,
            workBranch, workBatchKey, promptTokens, cachedPromptTokens, completionTokens, totalTokens,
            promptCost, cachedPromptCost, completionCost, cost, timeoutCount, httpGetCount, httpGetSuccessCount,
            dbQueryCount, startedAt, finishedAt, durationMs, createdAt, interactionCount, problemId, problemTitle,
            requestTitle
        );
    }
}
