package com.aihub.hub.dto;

import java.util.List;

public record CodexTaskResponse(String id, String model, String content, List<CodexToolCall> toolCalls) {
}
