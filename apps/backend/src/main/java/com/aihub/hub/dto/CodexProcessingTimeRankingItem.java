package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequestStatus;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.Instant;

public record CodexProcessingTimeRankingItem(
    Long id,
    String environment,
    String model,
    CodexReasoningEffort reasoningEffort,
    CodexIntegrationProfile profile,
    CodexRequestStatus status,
    Long durationMs,
    Instant createdAt,
    @JsonIgnore String prompt,
    @JsonIgnore String responseText,
    String requestTitle
) {
    public CodexProcessingTimeRankingItem withRequestTitle(String requestTitle) {
        return new CodexProcessingTimeRankingItem(
            id, environment, model, reasoningEffort, profile, status,
            durationMs, createdAt, prompt, responseText, requestTitle
        );
    }
}
