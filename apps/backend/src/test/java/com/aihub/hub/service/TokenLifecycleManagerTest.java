package com.aihub.hub.service;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TokenLifecycleManagerTest {

    @Test
    void buildsTokenRefreshPayloadWithoutOrganizationId() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");

        Map<String, String> payload = manager.buildTokenRefreshPayload("refresh-token");

        assertThat(payload).containsEntry("grant_type", "refresh_token");
        assertThat(payload).containsEntry("refresh_token", "refresh-token");
        assertThat(payload).doesNotContainKey("organization_id");
        assertThat(payload).doesNotContainKey("id_token_add_organizations");
    }

    @Test
    void buildsOpenAIOrganizationHeader() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", " org-DgyTLAxNYnw0cOQVlAXInkyR ");

        Map<String, String> headers = manager.buildOpenAIOrganizationHeaders();

        assertThat(headers).containsEntry("OpenAI-Organization", "org-DgyTLAxNYnw0cOQVlAXInkyR");
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
        assertThat(payload).doesNotContainKey("organization_id");
    }

    @Test
    void detectsOrganizationClaimInsideIdTokenPayload() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        String idToken = jwtWithPayload("{\"https://api.openai.com/auth\":{\"organization_id\":\"org-DgyTLAxNYnw0cOQVlAXInkyR\"}}");

        assertThat(manager.idTokenHasOrganizationClaim(idToken, "org-DgyTLAxNYnw0cOQVlAXInkyR")).isTrue();
    }

    @Test
    void rejectsIdTokenWithoutExpectedOrganizationClaim() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        String idToken = jwtWithPayload("{\"https://api.openai.com/auth\":{\"chatgpt_account_id\":\"acct_123\"}}");

        assertThat(manager.idTokenHasOrganizationClaim(idToken, "org-DgyTLAxNYnw0cOQVlAXInkyR")).isFalse();
    }

    private String jwtWithPayload(String payload) {
        return base64Url("{\"alg\":\"none\"}") + "." + base64Url(payload) + ".signature";
    }

    private String base64Url(String value) {
        return Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
}
