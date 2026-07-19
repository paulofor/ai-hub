package com.aihub.mcpserver.config;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "mcp.server")
public record McpServerProperties(
        String apiToken,
        @Min(1) long commandTimeoutSeconds,
        @Min(1024) int maxOutputChars
) {
}
