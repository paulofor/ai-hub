package com.aihub.hub.dto;

import java.time.Instant;

public record PromptHintView(
    Long id,
    String label,
    String phrase,
    String type,
    boolean active,
    Long environmentId,
    String environmentName,
    Instant createdAt,
    Instant updatedAt
) {
}
