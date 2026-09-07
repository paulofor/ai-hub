package com.aihub.hub.dto;

import java.time.Instant;
import java.util.UUID;

public record PublicProxyRecoveryView(
    UUID requestId,
    String operation,
    String target,
    String status,
    String reason,
    Instant requestedAt,
    Instant updatedAt,
    Long githubRunId,
    String githubRunUrl,
    String githubConclusion
) {
}
