package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexRequestStatus;

import java.math.BigDecimal;
import java.time.Instant;

public record CodexProductRequest(
    Long id,
    CodexRequestStatus status,
    Instant createdAt,
    Instant startedAt,
    Instant finishedAt,
    Long durationMs,
    String processNumber,
    String processText,
    BigDecimal cost,
    Integer totalTokens
) {}
