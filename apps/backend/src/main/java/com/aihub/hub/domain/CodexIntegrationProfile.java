package com.aihub.hub.domain;

public enum CodexIntegrationProfile {
    STANDARD,
    ECONOMY;

    public static CodexIntegrationProfile fromString(String value) {
        if (value == null || value.isBlank()) {
            return STANDARD;
        }
        try {
            return CodexIntegrationProfile.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return STANDARD;
        }
    }
}
