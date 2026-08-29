package com.aihub.mcpserver.config;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "mcp.server")
public record McpServerProperties(
        String apiToken,
        @NotBlank String backendBaseUrl,
        @Min(1) long commandTimeoutSeconds,
        @Min(1024) int maxOutputChars
) {
}
