package com.aihub.hub.web;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.aihub.hub.service.SandboxOrchestratorClient;

import java.util.Map;
import java.util.List;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    @Value("${hub.codex.app-server-enabled:false}")
    private boolean codexAppServerEnabled;

    private final SandboxOrchestratorClient sandboxOrchestratorClient;
    private final MeterRegistry meterRegistry;

    @Autowired
    public AccountController(SandboxOrchestratorClient sandboxOrchestratorClient, MeterRegistry meterRegistry) {
        this.sandboxOrchestratorClient = sandboxOrchestratorClient;
        this.meterRegistry = meterRegistry;
    }

    @GetMapping("/read")
    public Map<String, Object> read() {
        if (!codexAppServerEnabled) {
            return legacyOAuthRemovedAccountState();
        }
        return requireSandboxOrchestratorClient().readCodexAccount();
    }

    @GetMapping("/models")
    public List<Map<String, Object>> models() {
        if (!codexAppServerEnabled) {
            return List.of();
        }
        return requireSandboxOrchestratorClient().listCodexModels();
    }

    @PostMapping("/login/start")
    public Map<String, Object> startLogin(@RequestBody(required = false) Map<String, Object> payload) {
        requireAppServerEnabled();
        String type = payload != null && payload.get("type") instanceof String text && !text.isBlank()
            ? text.trim()
            : "chatgptDeviceCode";
        meterRegistry.counter("codex_app_server_login_start_total").increment();
        return requireSandboxOrchestratorClient().startCodexLogin(type);
    }

    @PostMapping("/device/start")
    public Map<String, Object> startDeviceLogin() {
        requireAppServerEnabled();
        meterRegistry.counter("codex_app_server_device_login_start_total").increment();
        return requireSandboxOrchestratorClient().startCodexLogin("chatgptDeviceCode");
    }

    @PostMapping("/device/poll")
    public Map<String, Object> pollDeviceLogin() {
        requireAppServerEnabled();
        return requireSandboxOrchestratorClient().readCodexAccount();
    }

    @GetMapping("/login/callback")
    public void loginCallback() {
        throw new ResponseStatusException(
            HttpStatus.GONE,
            "Callback OAuth legado removido. A autenticação CHATGPT_CODEX é gerenciada pelo Codex App Server."
        );
    }

    @PostMapping("/logout")
    public Map<String, Object> logout() {
        if (codexAppServerEnabled) {
            meterRegistry.counter("codex_app_server_logout_total").increment();
            return requireSandboxOrchestratorClient().logoutCodexAccount();
        }
        return Map.of(
            "connected", false,
            "status", "app_server_disabled",
            "executable", false,
            "blockReason", "CODEX_APP_SERVER_DISABLED"
        );
    }

    @PostMapping("/login/cancel")
    public Map<String, Object> cancelLogin(@RequestBody(required = false) Map<String, Object> payload) {
        requireAppServerEnabled();
        String loginId = payload != null && payload.get("loginId") instanceof String text ? text.trim() : null;
        if (loginId == null || loginId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "loginId é obrigatório para cancelar login Codex.");
        }
        return requireSandboxOrchestratorClient().cancelCodexLogin(loginId);
    }

    private Map<String, Object> legacyOAuthRemovedAccountState() {
        return Map.<String, Object>ofEntries(
            Map.entry("connected", false),
            Map.entry("status", "app_server_disabled"),
            Map.entry("authMode", "codex_app_server"),
            Map.entry("planType", ""),
            Map.entry("requiresOpenaiAuth", true),
            Map.entry("executable", false),
            Map.entry("blockReason", "CODEX_APP_SERVER_DISABLED"),
            Map.entry("message", "Fluxo OAuth legado removido. Habilite CODEX_APP_SERVER_ENABLED e autentique pelo Codex App Server.")
        );
    }

    private void requireAppServerEnabled() {
        if (!codexAppServerEnabled) {
            throw new ResponseStatusException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Fluxo OAuth legado removido. A autenticação CHATGPT_CODEX deve ser feita pelo Codex App Server."
            );
        }
    }

    private SandboxOrchestratorClient requireSandboxOrchestratorClient() {
        if (sandboxOrchestratorClient == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Codex App Server indisponível: cliente do sandbox-orchestrator não configurado.");
        }
        return sandboxOrchestratorClient;
    }
}
