package com.aihub.hub.dto;

import com.fasterxml.jackson.databind.JsonNode;

public record CodexToolCall(String name, JsonNode arguments) {
}
