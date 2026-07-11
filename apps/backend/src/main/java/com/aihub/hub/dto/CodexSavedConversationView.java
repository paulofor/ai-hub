package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;

import java.time.Instant;
import java.util.List;

public record CodexSavedConversationView(
    Long id,
    String title,
    String environment,
    String model,
    CodexIntegrationProfile profile,
    Integer messageCount,
    List<SaveCodexConversationRequest.Message> messages,
    Instant createdAt,
    Instant updatedAt
) {
}
