package com.aihub.hub.service;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TokenLifecycleManagerTest {

    @Test
    void buildsTokenRefreshPayloadWithOrganizationClaims() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");

        Map<String, String> payload = manager.buildTokenRefreshPayload("refresh-token");

        assertThat(payload).containsEntry("grant_type", "refresh_token");
        assertThat(payload).containsEntry("refresh_token", "refresh-token");
        assertThat(payload).containsEntry("id_token_add_organizations", "true");
        assertThat(payload).containsEntry("organization_id", "org-DgyTLAxNYnw0cOQVlAXInkyR");
    }

    @Test
    void buildsCodexApiTokenExchangePayload() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");

        Map<String, String> payload = manager.buildCodexApiTokenExchangePayload("id-token", "app_client");

        assertThat(payload).containsEntry("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange");
        assertThat(payload).containsEntry("client_id", "app_client");
        assertThat(payload).containsEntry("requested_token", "openai-api-key");
        assertThat(payload).containsEntry("subject_token", "id-token");
        assertThat(payload).containsEntry("subject_token_type", "urn:ietf:params:oauth:token-type:id_token");
        assertThat(payload).containsEntry("organization_id", "org-DgyTLAxNYnw0cOQVlAXInkyR");
    }
}
