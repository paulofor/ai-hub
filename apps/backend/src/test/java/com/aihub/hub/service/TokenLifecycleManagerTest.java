package com.aihub.hub.service;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TokenLifecycleManagerTest {

    @Test
    void buildsTokenRefreshPayloadWithOrganizationIdWhenConfigured() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");
        ReflectionTestUtils.setField(manager, "oauthClientId", "");
        ReflectionTestUtils.setField(manager, "oauthDeviceClientId", "app_EMoamEEZ73f0CkXaXp7hrann");

        Map<String, String> payload = manager.buildTokenRefreshPayload("refresh-token");

        assertThat(payload).containsEntry("grant_type", "refresh_token");
        assertThat(payload).containsEntry("refresh_token", "refresh-token");
        assertThat(payload).containsEntry("client_id", "app_EMoamEEZ73f0CkXaXp7hrann");
        assertThat(payload).containsEntry("scope", "openid profile email");
        assertThat(payload).containsEntry("organization_id", "org-DgyTLAxNYnw0cOQVlAXInkyR");
        assertThat(payload).doesNotContainKey("id_token_add_organizations");
    }


    @Test
    void tokenRefreshPayloadUsesSessionDeviceClientOverConfiguredBrowserClient() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthClientId", "app_browser_client");
        ReflectionTestUtils.setField(manager, "oauthClientSecret", "browser-secret");
        ReflectionTestUtils.setField(manager, "oauthDeviceClientId", "app_EMoamEEZ73f0CkXaXp7hrann");
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(TokenLifecycleManager.OAUTH_CLIENT_ID_KEY, "app_EMoamEEZ73f0CkXaXp7hrann");
        session.setAttribute(TokenLifecycleManager.OAUTH_CLIENT_TYPE_KEY, TokenLifecycleManager.OAUTH_CLIENT_TYPE_PUBLIC);

        Map<String, String> payload = manager.buildTokenRefreshPayload(session, "refresh-token");

        assertThat(payload).containsEntry("client_id", "app_EMoamEEZ73f0CkXaXp7hrann");
        assertThat(payload).containsEntry("organization_id", "org-DgyTLAxNYnw0cOQVlAXInkyR");
        assertThat(payload).doesNotContainKey("client_secret");
        assertThat(payload).doesNotContainKey("id_token_add_organizations");
    }

    @Test
    void tokenRefreshPayloadUsesSessionBrowserClientSecretOnlyForConfidentialSession() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthClientId", "app_browser_client");
        ReflectionTestUtils.setField(manager, "oauthClientSecret", "browser-secret");
        ReflectionTestUtils.setField(manager, "oauthDeviceClientId", "app_device_client");
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(TokenLifecycleManager.OAUTH_CLIENT_ID_KEY, "app_browser_client");
        session.setAttribute(TokenLifecycleManager.OAUTH_CLIENT_TYPE_KEY, TokenLifecycleManager.OAUTH_CLIENT_TYPE_CONFIDENTIAL);

        Map<String, String> payload = manager.buildTokenRefreshPayload(session, "refresh-token");

        assertThat(payload).containsEntry("client_id", "app_browser_client");
        assertThat(payload).containsEntry("client_secret", "browser-secret");
    }

    @Test
    void tokenRefreshPayloadPrefersConfiguredOauthClientIdWithoutSession() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthClientId", " app_browser_client ");
        ReflectionTestUtils.setField(manager, "oauthDeviceClientId", "app_device_client");

        Map<String, String> payload = manager.buildTokenRefreshPayload("refresh-token");

        assertThat(payload).containsEntry("client_id", "app_browser_client");
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

    @Test
    void blocksCodexTokenExchangeWhenConfiguredOrganizationClaimCannotBeRefreshed() {
        TokenLifecycleManager manager = new TokenLifecycleManager(new SimpleMeterRegistry());
        ReflectionTestUtils.setField(manager, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(TokenLifecycleManager.ID_TOKEN_KEY, jwtWithPayload("{\"email\":\"device@example.com\"}"));
        session.setAttribute(TokenLifecycleManager.OAUTH_CLIENT_TYPE_KEY, TokenLifecycleManager.OAUTH_CLIENT_TYPE_PUBLIC);

        Boolean allowed = ReflectionTestUtils.invokeMethod(manager, "ensureOrganizationClaimsForCodex", session);

        assertThat(allowed).isFalse();
        assertThat(session.getAttribute(TokenLifecycleManager.CODEX_TOKEN_BLOCK_REASON_KEY))
            .asString()
            .contains("refresh_token");
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
