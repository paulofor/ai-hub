package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequestStatus;

import java.time.Instant;
import java.util.List;

public record CodexQueueSnapshot(
    CodexIntegrationProfile profile,
    Instant updatedAt,
    List<Item> requests
) {
    public record Item(
        Long id,
        String environment,
        String model,
        CodexReasoningEffort reasoningEffort,
        CodexRequestStatus status,
        String requestTitle,
        Instant createdAt,
        Instant startedAt,
        int queuePosition
    ) { }
}
