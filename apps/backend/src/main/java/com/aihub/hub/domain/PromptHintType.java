package com.aihub.hub.domain;

public enum PromptHintType {
    PROMPT("prompt"),
    TEXT("text");

    private final String value;

    PromptHintType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static PromptHintType fromValue(String value) {
        if (value == null || value.isBlank()) {
            return PROMPT;
        }
        String normalized = value.trim();
        for (PromptHintType type : values()) {
            if (type.value.equalsIgnoreCase(normalized) || type.name().equalsIgnoreCase(normalized)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Tipo de item opcional inválido: use prompt ou text.");
    }
}
