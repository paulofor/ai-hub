package com.aihub.hub.web;

import com.aihub.hub.service.TokenLifecycleManager;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AccountControllerTest {

    @Test
    void deviceCodeTokenExchangePayloadDoesNotIncludeBrowserClientSecret() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        AccountController controller = new AccountController(new TokenLifecycleManager(meterRegistry), meterRegistry);
        ReflectionTestUtils.setField(controller, "oauthClientSecret", "browser-secret");

        Map<String, String> payload = controller.buildTokenExchangePayload(
            "authorization-code",
            "code-verifier",
            "https://auth.openai.com/deviceauth/callback",
            "app_device_client_123",
            false
        );

        assertThat(payload).containsEntry("grant_type", "authorization_code");
        assertThat(payload).containsEntry("client_id", "app_device_client_123");
        assertThat(payload).containsEntry("code", "authorization-code");
        assertThat(payload).containsEntry("redirect_uri", "https://auth.openai.com/deviceauth/callback");
        assertThat(payload).containsEntry("code_verifier", "code-verifier");
        assertThat(payload).doesNotContainKey("client_secret");
    }

    @Test
    void deviceUserCodePayloadMatchesCodexRsPublicClientRequest() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        AccountController controller = new AccountController(new TokenLifecycleManager(meterRegistry), meterRegistry);
        ReflectionTestUtils.setField(controller, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");

        Map<String, Object> payload = controller.buildDeviceUserCodePayload("app_device_client_123");

        assertThat(payload).containsEntry("client_id", "app_device_client_123");
        assertThat(payload).doesNotContainKey("id_token_add_organizations");
        assertThat(payload).doesNotContainKey("organization_id");
    }

    @Test
    void browserAuthorizeUrlRequestsOrganizationClaims() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        AccountController controller = new AccountController(new TokenLifecycleManager(meterRegistry), meterRegistry);
        ReflectionTestUtils.setField(controller, "oauthAuthorizeUrl", "https://auth.openai.com/oauth/authorize");
        ReflectionTestUtils.setField(controller, "oauthClientId", "app_browser_client_123");
        ReflectionTestUtils.setField(controller, "oauthScopes", "openid profile email offline_access");
        ReflectionTestUtils.setField(controller, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");

        String authUrl = ReflectionTestUtils.invokeMethod(
            controller,
            "buildExternalAuthUrl",
            "https://iahub.xyz/api/account/login/callback",
            "state-123",
            "challenge-123"
        );

        assertThat(authUrl).contains("id_token_add_organizations=true");
        assertThat(authUrl).contains("codex_cli_simplified_flow=true");
        assertThat(authUrl).contains("allowed_workspace_id=org-DgyTLAxNYnw0cOQVlAXInkyR");
        assertThat(authUrl).doesNotContain("organization_id=org-DgyTLAxNYnw0cOQVlAXInkyR");
    }

    @Test
    void browserAuthorizeUrlFallsBackToPublicDeviceClientWhenConfiguredBrowserClientIsInvalid() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        AccountController controller = new AccountController(new TokenLifecycleManager(meterRegistry), meterRegistry);
        ReflectionTestUtils.setField(controller, "oauthAuthorizeUrl", "https://auth.openai.com/oauth/authorize");
        ReflectionTestUtils.setField(controller, "oauthClientId", "paulofore");
        ReflectionTestUtils.setField(controller, "oauthDeviceClientId", "app_EMoamEEZ73f0CkXaXp7hrann");
        ReflectionTestUtils.setField(controller, "oauthScopes", "openid profile email offline_access");
        ReflectionTestUtils.setField(controller, "oauthOrganizationId", "org-DgyTLAxNYnw0cOQVlAXInkyR");

        String authUrl = ReflectionTestUtils.invokeMethod(
            controller,
            "buildExternalAuthUrl",
            "https://iahub.xyz/api/account/login/callback",
            "state-123",
            "challenge-123"
        );

        assertThat(authUrl).contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
        assertThat(authUrl).contains("id_token_add_organizations=true");
        assertThat(authUrl).contains("allowed_workspace_id=org-DgyTLAxNYnw0cOQVlAXInkyR");
    }


    @Test
    void persistDeviceLoginTokenResponseStoresPublicOauthClientOrigin() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        AccountController controller = new AccountController(new TokenLifecycleManager(meterRegistry), meterRegistry);
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(TokenLifecycleManager.ACCOUNT_EMAIL_KEY, "device@example.com");

        ReflectionTestUtils.invokeMethod(
            controller,
            "persistTokenResponse",
            session,
            Map.of(
                "access_token", "access-token",
                "refresh_token", "refresh-token",
                "id_token", jwtWithPayload("{\"email\":\"device@example.com\"}"),
                "expires_in", 3600
            ),
            "app_EMoamEEZ73f0CkXaXp7hrann",
            TokenLifecycleManager.OAUTH_CLIENT_TYPE_PUBLIC
        );

        assertThat(session.getAttribute(TokenLifecycleManager.OAUTH_CLIENT_ID_KEY)).isEqualTo("app_EMoamEEZ73f0CkXaXp7hrann");
        assertThat(session.getAttribute(TokenLifecycleManager.OAUTH_CLIENT_TYPE_KEY)).isEqualTo(TokenLifecycleManager.OAUTH_CLIENT_TYPE_PUBLIC);
    }

    @Test
    void browserTokenExchangePayloadKeepsConfiguredClientSecret() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        AccountController controller = new AccountController(new TokenLifecycleManager(meterRegistry), meterRegistry);
        ReflectionTestUtils.setField(controller, "oauthClientSecret", "browser-secret");

        Map<String, String> payload = controller.buildTokenExchangePayload(
            "authorization-code",
            "code-verifier",
            "https://iahub.xyz/api/account/login/callback",
            "app_browser_client_123",
            true
        );

        assertThat(payload).containsEntry("client_secret", "browser-secret");
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
