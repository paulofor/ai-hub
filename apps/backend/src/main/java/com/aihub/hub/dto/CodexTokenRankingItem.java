package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequestStatus;
import java.math.BigDecimal;
import java.time.Instant;

public record CodexTokenRankingItem(
    Long id,
    String environment,
    String model,
    CodexReasoningEffort reasoningEffort,
    CodexIntegrationProfile profile,
    CodexRequestStatus status,
    Integer promptTokens,
    Integer cachedPromptTokens,
    Integer completionTokens,
    Integer totalTokens,
    BigDecimal cost,
    Long durationMs,
    Instant createdAt
) {
}
