package com.aihub.hub.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import java.util.Arrays;

public enum CodexReasoningEffort {
    LOW("low"),
    MEDIUM("medium"),
    HIGH("high"),
    XHIGH("xhigh");

    private final String value;

    CodexReasoningEffort(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }

    @JsonCreator
    public static CodexReasoningEffort fromValue(String candidate) {
        if (candidate == null || candidate.isBlank()) {
            return null;
        }
        return Arrays.stream(values())
            .filter(value -> value.value.equalsIgnoreCase(candidate.trim()))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException(
                "reasoningEffort deve ser low, medium, high ou xhigh"
            ));
    }
}
