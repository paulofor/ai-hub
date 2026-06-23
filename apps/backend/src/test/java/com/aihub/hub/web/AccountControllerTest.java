package com.aihub.hub.web;

import com.aihub.hub.service.SandboxOrchestratorClient;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AccountControllerTest {

    @Test
    void readReturnsRemovedLegacyStateWhenAppServerIsDisabled() {
        AccountController controller = new AccountController(null, new SimpleMeterRegistry());

        Map<String, Object> response = controller.read();

        assertThat(response).containsEntry("connected", false);
        assertThat(response).containsEntry("status", "app_server_disabled");
        assertThat(response).containsEntry("executable", false);
        assertThat(response).containsEntry("blockReason", "CODEX_APP_SERVER_DISABLED");
        assertThat(response.get("message")).asString().contains("Fluxo OAuth legado removido");
    }

    @Test
    void loginStartRejectsLegacyOAuthWhenAppServerIsDisabled() {
        AccountController controller = new AccountController(null, new SimpleMeterRegistry());

        assertThatThrownBy(() -> controller.startLogin(Map.of()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("Fluxo OAuth legado removido");
    }

    @Test
    void legacyCallbackIsRemovedEvenWhenAppServerIsEnabled() {
        AccountController controller = new AccountController(null, new SimpleMeterRegistry());
        ReflectionTestUtils.setField(controller, "codexAppServerEnabled", true);

        assertThatThrownBy(controller::loginCallback)
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("Callback OAuth legado removido");
    }

    @Test
    void appServerReadProxiesSandboxAccountState() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        SandboxOrchestratorClient sandbox = mock(SandboxOrchestratorClient.class);
        when(sandbox.readCodexAccount()).thenReturn(Map.of(
            "connected", true,
            "status", "connected",
            "authMode", "chatgpt",
            "planType", "plus",
            "executable", true
        ));
        AccountController controller = new AccountController(sandbox, meterRegistry);
        ReflectionTestUtils.setField(controller, "codexAppServerEnabled", true);

        Map<String, Object> response = controller.read();

        assertThat(response).containsEntry("authMode", "chatgpt");
        assertThat(response).containsEntry("executable", true);
        verify(sandbox).readCodexAccount();
    }

    @Test
    void appServerLoginStartUsesDeviceCodeByDefault() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        SandboxOrchestratorClient sandbox = mock(SandboxOrchestratorClient.class);
        when(sandbox.startCodexLogin("chatgptDeviceCode")).thenReturn(Map.of(
            "status", "authorization_pending",
            "loginId", "login-123",
            "verificationUrl", "https://auth.openai.com/codex/device",
            "userCode", "ABCD-1234"
        ));
        AccountController controller = new AccountController(sandbox, meterRegistry);
        ReflectionTestUtils.setField(controller, "codexAppServerEnabled", true);

        Map<String, Object> response = controller.startLogin(Map.of());

        assertThat(response).containsEntry("loginId", "login-123");
        assertThat(response).containsEntry("userCode", "ABCD-1234");
        verify(sandbox).startCodexLogin("chatgptDeviceCode");
    }

    @Test
    void appServerDeviceStartUsesDeviceCode() {
        SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
        SandboxOrchestratorClient sandbox = mock(SandboxOrchestratorClient.class);
        when(sandbox.startCodexLogin("chatgptDeviceCode")).thenReturn(Map.of("loginId", "login-device"));
        AccountController controller = new AccountController(sandbox, meterRegistry);
        ReflectionTestUtils.setField(controller, "codexAppServerEnabled", true);

        Map<String, Object> response = controller.startDeviceLogin();

        assertThat(response).containsEntry("loginId", "login-device");
        verify(sandbox).startCodexLogin("chatgptDeviceCode");
    }

    @Test
    void appServerCancelRequiresLoginId() {
        AccountController controller = new AccountController(mock(SandboxOrchestratorClient.class), new SimpleMeterRegistry());
        ReflectionTestUtils.setField(controller, "codexAppServerEnabled", true);

        assertThatThrownBy(() -> controller.cancelLogin(Map.of()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("loginId é obrigatório");
    }
}
