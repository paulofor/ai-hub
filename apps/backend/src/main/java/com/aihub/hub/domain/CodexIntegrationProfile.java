package com.aihub.hub.domain;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum CodexIntegrationProfile {
    STANDARD,
    ECONOMY,
    SMART_ECONOMY,
    ECO_1,
    ECO_2,
    ECO_3,
    ECO_30,
    CHATGPT_CODEX,
    CHATGPT_CODEX_MKT,
    CHATGPT_CODEX_SANDBOX;

    @JsonCreator
    public static CodexIntegrationProfile fromString(String value) {
        if (value == null || value.isBlank()) {
            return STANDARD;
        }
        String normalized = value.trim().toUpperCase().replace('-', '_');
        try {
            return CodexIntegrationProfile.valueOf(normalized);
        } catch (IllegalArgumentException ex) {
            return STANDARD;
        }
    }
}
