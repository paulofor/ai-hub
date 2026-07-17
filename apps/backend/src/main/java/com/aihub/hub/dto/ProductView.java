package com.aihub.hub.dto;

import java.time.Instant;

public record ProductView(
    Long id,
    String name,
    String slug,
    String externalId,
    Instant createdAt,
    Instant updatedAt
) {
}
