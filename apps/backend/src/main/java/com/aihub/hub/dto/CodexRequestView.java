package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexRequestRecord;

import java.time.Instant;

public record CodexRequestView(
    Long id,
    String environment,
    String model,
    String prompt,
    String responseText,
    String externalId,
    Instant createdAt
) {

    public static CodexRequestView from(CodexRequestRecord record) {
        return new CodexRequestView(
            record.getId(),
            record.getEnvironment(),
            record.getModel(),
            record.getPrompt(),
            record.getResponseText(),
            record.getExternalId(),
            record.getCreatedAt()
        );
    }
}
