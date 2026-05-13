package com.aihub.mcpserver.model;

public record CommandResponse(
        int exitCode,
        String stdout,
        String stderr
) {
}
