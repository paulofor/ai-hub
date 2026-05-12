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
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    private static final String ACCOUNT_EMAIL_KEY = "chatgpt_account_email";
    private static final String EXPIRES_AT_KEY = "chatgpt_expires_at";
    private static final String ACCESS_TOKEN_KEY = "chatgpt_access_token";
    private static final String REFRESH_TOKEN_KEY = "chatgpt_refresh_token";
    private static final String ID_TOKEN_KEY = "chatgpt_id_token";
    private static final String LOGIN_STATE_KEY = "chatgpt_login_state";

    @Value("${hub.account.openai-auth-url:https://chatgpt.com/auth/login}")
    private String openAiAuthUrl;

    @Value("${hub.account.openai-auth-redirect-param:redirect_uri}")
    private String openAiAuthRedirectParam;

    @Value("${hub.account.login-success-redirect:/codex-chatgpt}")
    private String loginSuccessRedirect;

    @Value("${hub.account.login-callback-url:/api/account/login/callback}")
    private String loginCallbackUrl;

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
        String state = UUID.randomUUID().toString();
        session.setAttribute(LOGIN_STATE_KEY, state);
        String callback = loginCallbackUrl
            + "?state=" + urlEncode(state)
            + (accountHint != null ? "&email=" + urlEncode(accountHint) : "");
        String authUrl = buildExternalAuthUrl(callback);

        return Map.of(
            "status", "redirect_required",
            "authUrl", authUrl,
            "url", authUrl,
            "callbackUrl", callback,
            "externalAuthUrl", openAiAuthUrl
        );
    }

    @GetMapping("/login/callback")
    public void loginCallback(
        @RequestParam(name = "email", required = false) String email,
        @RequestParam(name = "state", required = false) String state,
        @RequestParam(name = "access_token", required = false) String accessToken,
        @RequestParam(name = "refresh_token", required = false) String refreshToken,
        @RequestParam(name = "id_token", required = false) String idToken,
        HttpSession session,
        HttpServletResponse response
    ) throws IOException {
        String expectedState = (String) session.getAttribute(LOGIN_STATE_KEY);
        if (expectedState == null || state == null || !expectedState.equals(state)) {
            clearSession(session);
            response.sendRedirect(loginSuccessRedirect + "?login=invalid_state");
            return;
        }

        String accountEmail = (email != null && !email.isBlank()) ? email.trim() : (String) session.getAttribute(ACCOUNT_EMAIL_KEY);
        if (accountEmail == null || accountEmail.isBlank()) {
            clearSession(session);
            response.sendRedirect(loginSuccessRedirect + "?login=missing_email");
            return;
        }
        session.setAttribute(ACCOUNT_EMAIL_KEY, accountEmail);
        session.setAttribute(EXPIRES_AT_KEY, Instant.now().plus(8, ChronoUnit.HOURS).toString());
        if (accessToken != null && !accessToken.isBlank()) {
            session.setAttribute(ACCESS_TOKEN_KEY, accessToken.trim());
        }
        if (refreshToken != null && !refreshToken.isBlank()) {
            session.setAttribute(REFRESH_TOKEN_KEY, refreshToken.trim());
        }
        if (idToken != null && !idToken.isBlank()) {
            session.setAttribute(ID_TOKEN_KEY, idToken.trim());
        }
        session.removeAttribute(LOGIN_STATE_KEY);
        response.sendRedirect(loginSuccessRedirect);
    }

    private String buildExternalAuthUrl(String callback) {
        String separator = openAiAuthUrl.contains("?") ? "&" : "?";
        return openAiAuthUrl + separator + openAiAuthRedirectParam + "=" + urlEncode(callback);
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private void clearSession(HttpSession session) {
        session.removeAttribute(ACCOUNT_EMAIL_KEY);
        session.removeAttribute(EXPIRES_AT_KEY);
        session.removeAttribute(ACCESS_TOKEN_KEY);
        session.removeAttribute(REFRESH_TOKEN_KEY);
        session.removeAttribute(ID_TOKEN_KEY);
        session.removeAttribute(LOGIN_STATE_KEY);
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpSession session) {
        clearSession(session);
        return Map.of(
            "connected", false,
            "status", "disconnected"
        );
    }
}
