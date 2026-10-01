package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import com.aihub.hub.domain.CodexRequestStatus;

import java.time.Instant;

/** Public conversation content, without agent prompts, transcripts or execution logs. */
public record CodexDialogueRequest(
    Long id,
    String environment,
    String model,
    CodexReasoningEffort reasoningEffort,
    CodexIntegrationProfile profile,
    CodexRequestStatus status,
    String userMessage,
    String responseText,
    String productName,
    Instant createdAt,
    Instant finishedAt
) { }
