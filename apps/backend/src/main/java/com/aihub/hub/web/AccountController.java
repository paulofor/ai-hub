package com.aihub.hub.web;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    private static final String ACCOUNT_EMAIL_KEY = "chatgpt_account_email";
    private static final String EXPIRES_AT_KEY = "chatgpt_expires_at";

    @Value("${hub.account.openai-auth-url:https://chatgpt.com/auth/login}")
    private String openAiAuthUrl;

    @Value("${hub.account.login-success-redirect:/codex-chatgpt}")
    private String loginSuccessRedirect;

    @GetMapping("/read")
    public Map<String, Object> read(HttpSession session) {
        String accountEmail = (String) session.getAttribute(ACCOUNT_EMAIL_KEY);
        String expiresAt = (String) session.getAttribute(EXPIRES_AT_KEY);
        boolean connected = accountEmail != null && expiresAt != null;
        return Map.<String, Object>ofEntries(
            Map.entry("connected", connected),
            Map.entry("status", connected ? "connected" : "disconnected"),
            Map.entry("accountEmail", connected ? accountEmail : ""),
            Map.entry("expiresAt", connected ? expiresAt : "")
        );
    }

    @PostMapping("/login/start")
    public Map<String, Object> startLogin(@RequestBody(required = false) Map<String, Object> payload, HttpSession session) {
        String accountHint = null;
        if (payload != null && payload.get("accountHint") instanceof String hint && !hint.isBlank()) {
            accountHint = hint.trim();
        }
        if (accountHint != null) {
            session.setAttribute(ACCOUNT_EMAIL_KEY, accountHint);
        }
        session.setAttribute(EXPIRES_AT_KEY, Instant.now().plus(8, ChronoUnit.HOURS).toString());
        String callback = "/api/account/login/callback" + (accountHint != null ? "?email=" + accountHint : "");

        return Map.of(
            "status", "redirect_required",
            "authUrl", openAiAuthUrl,
            "url", callback
        );
    }

    @GetMapping("/login/callback")
    public void loginCallback(
        @RequestParam(name = "email", required = false) String email,
        HttpSession session,
        HttpServletResponse response
    ) throws IOException {
        String accountEmail = (email != null && !email.isBlank()) ? email.trim() : (String) session.getAttribute(ACCOUNT_EMAIL_KEY);
        if (accountEmail == null || accountEmail.isBlank()) {
            accountEmail = "chatgpt-user@openai.com";
        }
        session.setAttribute(ACCOUNT_EMAIL_KEY, accountEmail);
        session.setAttribute(EXPIRES_AT_KEY, Instant.now().plus(8, ChronoUnit.HOURS).toString());
        response.sendRedirect(loginSuccessRedirect);
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpSession session) {
        session.removeAttribute(ACCOUNT_EMAIL_KEY);
        session.removeAttribute(EXPIRES_AT_KEY);
        return Map.of(
            "connected", false,
            "status", "disconnected"
        );
    }
}
