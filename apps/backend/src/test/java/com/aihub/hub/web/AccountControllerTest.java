package com.aihub.hub.web;

import com.aihub.hub.service.TokenLifecycleManager;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

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
            "app_device_client",
            false
        );

        assertThat(payload).containsEntry("grant_type", "authorization_code");
        assertThat(payload).containsEntry("client_id", "app_device_client");
        assertThat(payload).containsEntry("code", "authorization-code");
        assertThat(payload).containsEntry("redirect_uri", "https://auth.openai.com/deviceauth/callback");
        assertThat(payload).containsEntry("code_verifier", "code-verifier");
        assertThat(payload).doesNotContainKey("client_secret");
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
            "browser-client",
            true
        );

        assertThat(payload).containsEntry("client_secret", "browser-secret");
    }
}
