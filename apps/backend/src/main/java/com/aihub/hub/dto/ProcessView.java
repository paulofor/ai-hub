package com.aihub.hub.dto;

import java.time.Instant;

public record ProcessView(
    Long id,
    String number,
    String text,
    Long parentProcessId,
    String parentProcessNumber,
    Instant createdAt,
    Instant updatedAt
) {}
