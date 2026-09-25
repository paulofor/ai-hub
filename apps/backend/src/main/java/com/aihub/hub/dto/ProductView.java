package com.aihub.hub.dto;

import java.time.Instant;

public record ProductView(
    Long id,
    String name,
    String modelName,
    String reasoningEffort,
    Instant createdAt,
    Instant updatedAt
) {
}
