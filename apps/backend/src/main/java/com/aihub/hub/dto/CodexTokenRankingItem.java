package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequestStatus;
import com.fasterxml.jackson.annotation.JsonIgnore;
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
    Instant createdAt,
    @JsonIgnore String prompt,
    @JsonIgnore String responseText,
    String requestTitle
) {
    public CodexTokenRankingItem withRequestTitle(String requestTitle) {
        return new CodexTokenRankingItem(
            id, environment, model, reasoningEffort, profile, status,
            promptTokens, cachedPromptTokens, completionTokens, totalTokens,
            cost, durationMs, createdAt, prompt, responseText, requestTitle
        );
    }
}
