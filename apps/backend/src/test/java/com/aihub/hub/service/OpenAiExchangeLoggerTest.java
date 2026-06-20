package com.aihub.hub.service;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OpenAiExchangeLoggerTest {

    @Test
    void sanitizesSensitivePayloadFields() {
        Map<String, Object> sanitized = OpenAiExchangeLogger.sanitizeMap(Map.of(
            "access_token", "sk-secret",
            "refresh_token", "refresh-secret",
            "client_id", "app_client",
            "organization_id", "org_123"
        ));

        assertThat(sanitized).containsEntry("access_token", "[redacted]");
        assertThat(sanitized).containsEntry("refresh_token", "[redacted]");
        assertThat(sanitized).containsEntry("client_id", "app_client");
        assertThat(sanitized).containsEntry("organization_id", "org_123");
    }

    @Test
    void sanitizesSensitiveAuthorizeUrlParameters() {
        String sanitized = OpenAiExchangeLogger.sanitizeUrl(
            "https://auth.openai.com/oauth/authorize?client_id=app_client&state=abc&code_challenge=secret&allowed_workspace_id=org_123"
        );

        assertThat(sanitized).contains("client_id=app_client");
        assertThat(sanitized).contains("state=[redacted]");
        assertThat(sanitized).contains("code_challenge=[redacted]");
        assertThat(sanitized).contains("allowed_workspace_id=org_123");
    }
}
