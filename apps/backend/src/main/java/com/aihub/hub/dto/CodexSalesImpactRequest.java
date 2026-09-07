package com.aihub.hub.dto;

import java.time.Instant;

public record CodexSalesImpactRequest(
    long id,
    String title,
    Instant createdAt
) {
}
