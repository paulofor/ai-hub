package com.aihub.mcpserver.model;

import jakarta.validation.constraints.NotBlank;

public record CommandRequest(
        @NotBlank(message = "command is required")
        String command
) {
}
