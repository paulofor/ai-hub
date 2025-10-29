package com.aihub.hub.dto;

import java.time.Instant;

public record CodexSubmissionResponse(
    Long id,
    String environment,
    String prompt,
    String response,
    Instant createdAt
) {
}
