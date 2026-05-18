package com.aihub.hub.web;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletRequest;
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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.security.SecureRandom;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    private static final String ACCOUNT_EMAIL_KEY = "chatgpt_account_email";
    private static final String EXPIRES_AT_KEY = "chatgpt_expires_at";
    private static final String ACCESS_TOKEN_KEY = "chatgpt_access_token";
    private static final String REFRESH_TOKEN_KEY = "chatgpt_refresh_token";
    private static final String ID_TOKEN_KEY = "chatgpt_id_token";
    private static final String LOGIN_STATE_KEY = "chatgpt_login_state";
    private static final String LOGIN_PKCE_VERIFIER_KEY = "chatgpt_login_code_verifier";
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    @Value("${hub.account.oauth.authorize-url:https://auth.openai.com/oauth/authorize}")
    private String oauthAuthorizeUrl;
    @Value("${hub.account.oauth.client-id:}")
    private String oauthClientId;
    @Value("${hub.account.oauth.scopes:openid profile email offline_access}")
    private String oauthScopes;

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
    public Map<String, Object> startLogin(
        @RequestBody(required = false) Map<String, Object> payload,
        HttpSession session,
        HttpServletRequest request
    ) {
        String accountHint = null;
        if (payload != null && payload.get("accountHint") instanceof String hint && !hint.isBlank()) {
            accountHint = hint.trim();
        }
        if (accountHint != null) {
            session.setAttribute(ACCOUNT_EMAIL_KEY, accountHint);
        }
        String state = UUID.randomUUID().toString();
        String codeVerifier = generateCodeVerifier();
        String codeChallenge = generateCodeChallenge(codeVerifier);
        session.setAttribute(LOGIN_STATE_KEY, state);
        session.setAttribute(LOGIN_PKCE_VERIFIER_KEY, codeVerifier);
        String callbackBase = resolveCallbackBaseUrl(request);
        String authUrl = buildExternalAuthUrl(callbackBase, state, codeChallenge);

        return Map.of(
            "status", "redirect_required",
            "authUrl", authUrl,
            "url", authUrl,
            "callbackUrl", callbackBase,
            "state", state,
            "codeChallengeMethod", "S256"
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

    private String buildExternalAuthUrl(String redirectUri, String state, String codeChallenge) {
        String separator = oauthAuthorizeUrl.contains("?") ? "&" : "?";
        return oauthAuthorizeUrl
            + separator + "response_type=code"
            + "&client_id=" + urlEncode(oauthClientId)
            + "&redirect_uri=" + urlEncode(redirectUri)
            + "&scope=" + urlEncode(oauthScopes)
            + "&state=" + urlEncode(state)
            + "&code_challenge=" + urlEncode(codeChallenge)
            + "&code_challenge_method=S256";
    }

    private String resolveCallbackBaseUrl(HttpServletRequest request) {
        if (loginCallbackUrl.startsWith("http://") || loginCallbackUrl.startsWith("https://")) {
            return loginCallbackUrl;
        }
        String contextPath = request.getContextPath();
        String normalizedContext = (contextPath == null) ? "" : contextPath;
        String callbackPath = loginCallbackUrl.startsWith("/") ? loginCallbackUrl : "/" + loginCallbackUrl;
        return request.getScheme() + "://" + request.getServerName() + buildPortSuffix(request) + normalizedContext + callbackPath;
    }

    private String buildPortSuffix(HttpServletRequest request) {
        int port = request.getServerPort();
        boolean defaultHttp = "http".equalsIgnoreCase(request.getScheme()) && port == 80;
        boolean defaultHttps = "https".equalsIgnoreCase(request.getScheme()) && port == 443;
        if (defaultHttp || defaultHttps) {
            return "";
        }
        return ":" + port;
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String generateCodeVerifier() {
        byte[] randomBytes = new byte[32];
        SECURE_RANDOM.nextBytes(randomBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    }

    private String generateCodeChallenge(String codeVerifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 indisponível para PKCE", e);
        }
    }

    private void clearSession(HttpSession session) {
        session.removeAttribute(ACCOUNT_EMAIL_KEY);
        session.removeAttribute(EXPIRES_AT_KEY);
        session.removeAttribute(ACCESS_TOKEN_KEY);
        session.removeAttribute(REFRESH_TOKEN_KEY);
        session.removeAttribute(ID_TOKEN_KEY);
        session.removeAttribute(LOGIN_STATE_KEY);
        session.removeAttribute(LOGIN_PKCE_VERIFIER_KEY);
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
