package com.aihub.hub.dto;

import java.time.Instant;

public record ProductView(
    Long id,
    String name,
    Instant createdAt,
    Instant updatedAt
) {
}
