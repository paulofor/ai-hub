package com.aihub.hub.dto;

import org.springframework.data.domain.Page;

import java.time.Instant;

public record CodexProductHistory(
    String productName,
    long requestCount,
    Instant latestRequestAt,
    Page<CodexProductRequest> requests
) {}
