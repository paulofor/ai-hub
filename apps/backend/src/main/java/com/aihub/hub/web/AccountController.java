package com.aihub.hub.web;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.aihub.hub.service.TokenLifecycleManager;

import java.io.IOException;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.security.SecureRandom;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    private static final Logger log = LoggerFactory.getLogger(AccountController.class);

    private static final String ACCOUNT_EMAIL_KEY = TokenLifecycleManager.ACCOUNT_EMAIL_KEY;
    private static final String EXPIRES_AT_KEY = TokenLifecycleManager.EXPIRES_AT_KEY;
    private static final String ACCESS_TOKEN_KEY = TokenLifecycleManager.ACCESS_TOKEN_KEY;
    private static final String REFRESH_TOKEN_KEY = TokenLifecycleManager.REFRESH_TOKEN_KEY;
    private static final String ID_TOKEN_KEY = TokenLifecycleManager.ID_TOKEN_KEY;
    private static final String LOGIN_STATE_KEY = "chatgpt_login_state";
    private static final String LOGIN_PKCE_VERIFIER_KEY = "chatgpt_login_code_verifier";
    private static final String DEVICE_AUTH_ID_KEY = "chatgpt_device_auth_id";
    private static final String DEVICE_USER_CODE_KEY = "chatgpt_device_user_code";
    private static final String DEVICE_INTERVAL_KEY = "chatgpt_device_interval";
    private static final String DEVICE_EXPIRES_AT_KEY = "chatgpt_device_expires_at";
    private static final String DEFAULT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
    private static final long DEVICE_AUTH_TTL_SECONDS = 15 * 60;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    @Value("${hub.account.oauth.authorize-url:https://auth.openai.com/oauth/authorize}")
    private String oauthAuthorizeUrl;
    @Value("${hub.account.oauth.client-id:}")
    private String oauthClientId;
    @Value("${hub.account.oauth.scopes:openid profile email offline_access}")
    private String oauthScopes;
    @Value("${hub.account.oauth.token-url:https://auth.openai.com/oauth/token}")
    private String oauthTokenUrl;
    @Value("${hub.account.oauth.client-secret:}")
    private String oauthClientSecret;
    @Value("${hub.account.oauth.device-client-id:app_EMoamEEZ73f0CkXaXp7hrann}")
    private String oauthDeviceClientId;

    @Value("${hub.account.login-success-redirect:/codex-chatgpt}")
    private String loginSuccessRedirect;

    @Value("${hub.account.login-callback-url:/api/account/login/callback}")
    private String loginCallbackUrl;
    private final RestClient restClient = RestClient.builder().build();
    private final TokenLifecycleManager tokenLifecycleManager;
    private final MeterRegistry meterRegistry;

    public AccountController(TokenLifecycleManager tokenLifecycleManager, MeterRegistry meterRegistry) {
        this.tokenLifecycleManager = tokenLifecycleManager;
        this.meterRegistry = meterRegistry;
    }

    @GetMapping("/read")
    public Map<String, Object> read(HttpSession session) {
        try {
            tokenLifecycleManager.refreshIfNeeded(session);
        } catch (Exception ignored) {
            // Falha de refresh não deve quebrar leitura de estado; UI exibirá reconexão.
        }
        String accountEmail = (String) session.getAttribute(ACCOUNT_EMAIL_KEY);
        String expiresAt = (String) session.getAttribute(EXPIRES_AT_KEY);
        boolean connected = isConnected(accountEmail, expiresAt);
        String oauthStatus = oauthReadinessStatus();
        boolean oauthConfigured = "ready".equals(oauthStatus);
        return Map.<String, Object>ofEntries(
            Map.entry("connected", connected),
            Map.entry("status", connected ? "connected" : "disconnected"),
            Map.entry("accountEmail", connected ? accountEmail : ""),
            Map.entry("expiresAt", connected ? expiresAt : ""),
            Map.entry("oauthConfigured", oauthConfigured),
            Map.entry("oauthStatus", oauthStatus),
            Map.entry("oauthMessage", oauthReadinessMessage(oauthStatus)),
            Map.entry("deviceLoginAvailable", true),
            Map.entry("deviceLoginClientId", maskClientId(resolveDeviceClientId()))
        );
    }

    @PostMapping("/login/start")
    public Map<String, Object> startLogin(
        @RequestBody(required = false) Map<String, Object> payload,
        HttpSession session,
        HttpServletRequest request
    ) {
        String correlationId = UUID.randomUUID().toString();
        MDC.put("oauthCorrelationId", correlationId);
        String accountHint = null;
        if (payload != null && payload.get("accountHint") instanceof String hint && !hint.isBlank()) {
            accountHint = hint.trim();
        }
        if (accountHint != null) {
            session.setAttribute(ACCOUNT_EMAIL_KEY, accountHint);
        }
        String oauthStatus = oauthReadinessStatus();
        if (!"ready".equals(oauthStatus)) {
            log.error("OAuth login start abortado: {}", oauthReadinessMessage(oauthStatus));
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, oauthReadinessMessage(oauthStatus));
        }

        String state = UUID.randomUUID().toString();
        String codeVerifier = generateCodeVerifier();
        String codeChallenge = generateCodeChallenge(codeVerifier);
        session.setAttribute(LOGIN_STATE_KEY, state);
        session.setAttribute(LOGIN_PKCE_VERIFIER_KEY, codeVerifier);
        String callbackBase = resolveCallbackBaseUrl(request);
        String authUrl = buildExternalAuthUrl(callbackBase, state, codeChallenge);
        meterRegistry.counter("oauth_login_start_total").increment();
        log.info("OAuth login start gerado (callback={}, hasHint={}, correlationId={})", callbackBase, accountHint != null, correlationId);
        MDC.remove("oauthCorrelationId");

        return Map.of(
            "status", "redirect_required",
            "authUrl", authUrl,
            "url", authUrl,
            "callbackUrl", callbackBase,
            "state", state,
            "codeChallengeMethod", "S256"
        );
    }


    @PostMapping("/device/start")
    public Map<String, Object> startDeviceLogin(
        @RequestBody(required = false) Map<String, Object> payload,
        HttpSession session
    ) {
        String accountHint = null;
        if (payload != null && payload.get("accountHint") instanceof String hint && !hint.isBlank()) {
            accountHint = hint.trim();
            session.setAttribute(ACCOUNT_EMAIL_KEY, accountHint);
        }

        String clientId = resolveDeviceClientId();
        Map<String, Object> userCodeResponse = requestDeviceUserCode(clientId);
        String deviceAuthId = asString(userCodeResponse.get("device_auth_id"));
        String userCode = asString(firstPresent(userCodeResponse, "user_code", "usercode"));
        Long interval = asLong(userCodeResponse.get("interval"));
        if (deviceAuthId == null || deviceAuthId.isBlank() || userCode == null || userCode.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "OpenAI não retornou device_auth_id/user_code para login por código.");
        }

        Instant expiresAt = Instant.now().plusSeconds(DEVICE_AUTH_TTL_SECONDS);
        session.setAttribute(DEVICE_AUTH_ID_KEY, deviceAuthId.trim());
        session.setAttribute(DEVICE_USER_CODE_KEY, userCode.trim());
        session.setAttribute(DEVICE_INTERVAL_KEY, interval == null || interval <= 0 ? 5L : interval);
        session.setAttribute(DEVICE_EXPIRES_AT_KEY, expiresAt.toString());
        meterRegistry.counter("oauth_device_login_start_total").increment();

        return Map.of(
            "status", "authorization_pending",
            "verificationUrl", oauthIssuerBase() + "/codex/device",
            "userCode", userCode.trim(),
            "interval", interval == null || interval <= 0 ? 5L : interval,
            "expiresAt", expiresAt.toString(),
            "clientId", maskClientId(clientId),
            "accountHint", accountHint == null ? "" : accountHint
        );
    }

    @PostMapping("/device/poll")
    public Map<String, Object> pollDeviceLogin(HttpSession session) {
        String deviceAuthId = asString(session.getAttribute(DEVICE_AUTH_ID_KEY));
        String userCode = asString(session.getAttribute(DEVICE_USER_CODE_KEY));
        Instant expiresAt = parseInstant(asString(session.getAttribute(DEVICE_EXPIRES_AT_KEY)));
        if (deviceAuthId == null || deviceAuthId.isBlank() || userCode == null || userCode.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Nenhum login por código em andamento.");
        }
        if (expiresAt == null || !expiresAt.isAfter(Instant.now())) {
            clearDeviceLogin(session);
            return Map.of("status", "expired", "connected", false);
        }

        Map<String, Object> codeResponse = pollDeviceAuthorization(deviceAuthId, userCode);
        if (codeResponse == null) {
            return Map.of(
                "status", "authorization_pending",
                "connected", false,
                "verificationUrl", oauthIssuerBase() + "/codex/device",
                "userCode", userCode,
                "expiresAt", expiresAt.toString()
            );
        }

        String authorizationCode = asString(codeResponse.get("authorization_code"));
        String codeVerifier = asString(codeResponse.get("code_verifier"));
        if (authorizationCode == null || authorizationCode.isBlank() || codeVerifier == null || codeVerifier.isBlank()) {
            clearDeviceLogin(session);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "OpenAI autorizou o device login, mas não retornou authorization_code/code_verifier.");
        }

        Map<String, Object> tokenResponse = exchangeAuthorizationCode(authorizationCode.trim(), codeVerifier.trim(), oauthIssuerBase() + "/deviceauth/callback", resolveDeviceClientId(), false);
        persistTokenResponse(session, tokenResponse);
        clearDeviceLogin(session);
        meterRegistry.counter("oauth_device_login_success_total").increment();
        String accountEmail = asString(session.getAttribute(ACCOUNT_EMAIL_KEY));
        return Map.of(
            "status", "connected",
            "connected", true,
            "accountEmail", accountEmail == null ? "" : accountEmail,
            "expiresAt", asString(session.getAttribute(EXPIRES_AT_KEY)) == null ? "" : asString(session.getAttribute(EXPIRES_AT_KEY))
        );
    }

    @GetMapping("/login/callback")
    public void loginCallback(
        @RequestParam(name = "code", required = false) String code,
        @RequestParam(name = "state", required = false) String state,
        HttpSession session,
        HttpServletRequest request,
        HttpServletResponse response
    ) throws IOException {
        String correlationId = UUID.randomUUID().toString();
        MDC.put("oauthCorrelationId", correlationId);
        String expectedState = (String) session.getAttribute(LOGIN_STATE_KEY);
        if (expectedState == null || state == null || !expectedState.equals(state)) {
            clearSession(session);
            log.warn("OAuth callback inválido por state inconsistente (correlationId={})", correlationId);
            MDC.remove("oauthCorrelationId");
            response.sendRedirect(loginSuccessRedirect + "?login=invalid_state");
            return;
        }
        if (code == null || code.isBlank()) {
            clearSession(session);
            log.warn("OAuth callback sem authorization code (correlationId={})", correlationId);
            MDC.remove("oauthCorrelationId");
            response.sendRedirect(loginSuccessRedirect + "?login=token_exchange_failed");
            return;
        }

        String codeVerifier = (String) session.getAttribute(LOGIN_PKCE_VERIFIER_KEY);
        if (codeVerifier == null || codeVerifier.isBlank()) {
            clearSession(session);
            log.warn("OAuth callback sem PKCE verifier em sessão (correlationId={})", correlationId);
            MDC.remove("oauthCorrelationId");
            response.sendRedirect(loginSuccessRedirect + "?login=invalid_state");
            return;
        }
        String callbackBase = resolveCallbackBaseUrl(request);
        Map<String, Object> tokenResponse = exchangeAuthorizationCode(code.trim(), codeVerifier, callbackBase, oauthClientId, true);
        String accessToken = asString(tokenResponse.get("access_token"));
        String refreshToken = asString(tokenResponse.get("refresh_token"));
        String idToken = asString(tokenResponse.get("id_token"));
        Long expiresIn = asLong(tokenResponse.get("expires_in"));
        String accountEmail = resolveEmailFromIdToken(idToken);
        if ((accountEmail == null || accountEmail.isBlank()) && session.getAttribute(ACCOUNT_EMAIL_KEY) instanceof String hint && !hint.isBlank()) {
            accountEmail = hint.trim();
        }
        if (accountEmail == null || accountEmail.isBlank()) {
            clearSession(session);
            log.warn("OAuth callback sem e-mail resolvido após exchange (correlationId={})", correlationId);
            MDC.remove("oauthCorrelationId");
            response.sendRedirect(loginSuccessRedirect + "?login=missing_email");
            return;
        }
        if (accessToken == null || accessToken.isBlank()) {
            clearSession(session);
            log.warn("OAuth callback sem access_token após exchange (correlationId={})", correlationId);
            MDC.remove("oauthCorrelationId");
            response.sendRedirect(loginSuccessRedirect + "?login=token_exchange_failed");
            return;
        }
        persistTokenResponse(session, tokenResponse, accountEmail);
        session.removeAttribute(LOGIN_STATE_KEY);
        meterRegistry.counter("oauth_login_success_total").increment();
        log.info("OAuth login concluído com sucesso para conta {} (correlationId={})", accountEmail, correlationId);
        MDC.remove("oauthCorrelationId");
        response.sendRedirect(loginSuccessRedirect);
    }


    private Map<String, Object> requestDeviceUserCode(String clientId) {
        Map<String, Object> payload = buildDeviceUserCodePayload(clientId);
        return restClient.post()
            .uri(oauthIssuerBase() + "/api/accounts/deviceauth/usercode")
            .contentType(MediaType.APPLICATION_JSON)
            .body(payload)
            .retrieve()
            .body(Map.class);
    }

    Map<String, Object> buildDeviceUserCodePayload(String clientId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("client_id", clientId);
        payload.put("id_token_add_organizations", true);
        return payload;
    }

    private Map<String, Object> pollDeviceAuthorization(String deviceAuthId, String userCode) {
        Map<String, String> payload = Map.of(
            "device_auth_id", deviceAuthId,
            "user_code", userCode
        );
        try {
            return restClient.post()
                .uri(oauthIssuerBase() + "/api/accounts/deviceauth/token")
                .contentType(MediaType.APPLICATION_JSON)
                .body(payload)
                .retrieve()
                .body(Map.class);
        } catch (HttpStatusCodeException ex) {
            if (ex.getStatusCode().value() == 403 || ex.getStatusCode().value() == 404) {
                return null;
            }
            throw ex;
        }
    }

    private void persistTokenResponse(HttpSession session, Map<String, Object> tokenResponse) {
        String idToken = asString(tokenResponse.get("id_token"));
        String accountEmail = resolveEmailFromIdToken(idToken);
        if ((accountEmail == null || accountEmail.isBlank()) && session.getAttribute(ACCOUNT_EMAIL_KEY) instanceof String hint && !hint.isBlank()) {
            accountEmail = hint.trim();
        }
        persistTokenResponse(session, tokenResponse, accountEmail);
    }

    private void persistTokenResponse(HttpSession session, Map<String, Object> tokenResponse, String accountEmail) {
        String accessToken = asString(tokenResponse.get("access_token"));
        String refreshToken = asString(tokenResponse.get("refresh_token"));
        String idToken = asString(tokenResponse.get("id_token"));
        Long expiresIn = asLong(tokenResponse.get("expires_in"));
        if (accountEmail == null || accountEmail.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "OpenAI não retornou e-mail no id_token e não há e-mail sugerido para associar a sessão.");
        }
        if (accessToken == null || accessToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "OpenAI não retornou access_token após autorização.");
        }
        session.setAttribute(ACCOUNT_EMAIL_KEY, accountEmail.trim());
        Instant expiresAt = Instant.now().plus(resolveTtlSeconds(expiresIn), ChronoUnit.SECONDS);
        session.setAttribute(EXPIRES_AT_KEY, expiresAt.toString());
        session.setAttribute(ACCESS_TOKEN_KEY, accessToken.trim());
        if (refreshToken != null && !refreshToken.isBlank()) {
            session.setAttribute(REFRESH_TOKEN_KEY, refreshToken.trim());
        }
        if (idToken != null && !idToken.isBlank()) {
            session.setAttribute(ID_TOKEN_KEY, idToken.trim());
        }
    }

    private Map<String, Object> exchangeAuthorizationCode(String code, String codeVerifier, String redirectUri, String clientId, boolean includeClientSecret) {
        Map<String, String> payload = buildTokenExchangePayload(code, codeVerifier, redirectUri, clientId, includeClientSecret);
        return restClient.post()
            .uri(oauthTokenUrl)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(toFormUrlEncoded(payload))
            .retrieve()
            .body(Map.class);
    }


    Map<String, String> buildTokenExchangePayload(String code, String codeVerifier, String redirectUri, String clientId, boolean includeClientSecret) {
        Map<String, String> payload = new HashMap<>();
        payload.put("grant_type", "authorization_code");
        payload.put("client_id", clientId);
        payload.put("code", code);
        payload.put("redirect_uri", redirectUri);
        payload.put("code_verifier", codeVerifier);
        if (includeClientSecret && oauthClientSecret != null && !oauthClientSecret.isBlank()) {
            payload.put("client_secret", oauthClientSecret);
        }
        return payload;
    }

    private String toFormUrlEncoded(Map<String, String> values) {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getValue() == null || entry.getValue().isBlank()) {
                continue;
            }
            if (!first) {
                sb.append("&");
            }
            sb.append(urlEncode(entry.getKey())).append("=").append(urlEncode(entry.getValue()));
            first = false;
        }
        return sb.toString();
    }

    private String resolveEmailFromIdToken(String idToken) {
        if (idToken == null || idToken.isBlank()) {
            return null;
        }
        String[] parts = idToken.split("\\.");
        if (parts.length < 2) {
            return null;
        }
        try {
            String json = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
            int emailIdx = json.indexOf("\"email\"");
            if (emailIdx < 0) {
                return null;
            }
            int colonIdx = json.indexOf(":", emailIdx);
            int quoteStart = json.indexOf("\"", colonIdx + 1);
            int quoteEnd = json.indexOf("\"", quoteStart + 1);
            if (quoteStart < 0 || quoteEnd < 0) {
                return null;
            }
            return json.substring(quoteStart + 1, quoteEnd).trim();
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private String asString(Object value) {
        return value instanceof String text ? text : null;
    }

    private Long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String text) {
            try {
                return Long.parseLong(text);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
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
            + "&code_challenge_method=S256"
            + "&id_token_add_organizations=true";
    }

    private String resolveCallbackBaseUrl(HttpServletRequest request) {
        if (loginCallbackUrl.startsWith("http://") || loginCallbackUrl.startsWith("https://")) {
            return loginCallbackUrl;
        }
        String contextPath = request.getContextPath();
        String normalizedContext = (contextPath == null) ? "" : contextPath;
        String callbackPath = loginCallbackUrl.startsWith("/") ? loginCallbackUrl : "/" + loginCallbackUrl;
        String scheme = firstForwardedHeader(request, "X-Forwarded-Proto", request.getScheme());
        String host = firstForwardedHeader(request, "X-Forwarded-Host", request.getServerName());
        String port = firstForwardedHeader(request, "X-Forwarded-Port", null);
        return scheme + "://" + host + buildPortSuffix(scheme, host, port, request) + normalizedContext + callbackPath;
    }

    private String firstForwardedHeader(HttpServletRequest request, String headerName, String fallback) {
        String value = request.getHeader(headerName);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        int commaIdx = value.indexOf(',');
        String first = commaIdx >= 0 ? value.substring(0, commaIdx) : value;
        return first.trim();
    }

    private String buildPortSuffix(String scheme, String host, String forwardedPort, HttpServletRequest request) {
        if (host != null && host.contains(":")) {
            return "";
        }
        int port = parsePort(forwardedPort, request.getServerPort());
        boolean defaultHttp = "http".equalsIgnoreCase(scheme) && port == 80;
        boolean defaultHttps = "https".equalsIgnoreCase(scheme) && port == 443;
        if (defaultHttp || defaultHttps) {
            return "";
        }
        return ":" + port;
    }

    private int parsePort(String rawPort, int fallback) {
        if (rawPort == null || rawPort.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(rawPort.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private String oauthReadinessStatus() {
        if (oauthClientId == null || oauthClientId.isBlank()) {
            return "missing_client_id";
        }
        String trimmed = oauthClientId.trim();
        if (!trimmed.startsWith("app_") || trimmed.length() < 20 || trimmed.contains("@")) {
            return "invalid_client_id_format";
        }
        return "ready";
    }

    private String oauthReadinessMessage(String oauthStatus) {
        return switch (oauthStatus) {
            case "ready" -> "";
            case "invalid_client_id_format" -> "Integração OAuth indisponível: client_id configurado no servidor tem formato inválido. Use o client_id OAuth da OpenAI (normalmente iniciado por app_) e não e-mail, API key ou nome de usuário.";
            default -> "Integração OAuth indisponível: client_id não configurado no servidor.";
        };
    }


    private Object firstPresent(Map<String, Object> values, String... keys) {
        for (String key : keys) {
            if (values.containsKey(key)) {
                return values.get(key);
            }
        }
        return null;
    }

    private long resolveTtlSeconds(Long expiresIn) {
        return expiresIn == null || expiresIn <= 0 ? 8 * 60 * 60 : expiresIn;
    }

    private Instant parseInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String oauthIssuerBase() {
        if (oauthTokenUrl != null && oauthTokenUrl.contains("/oauth/token")) {
            return oauthTokenUrl.substring(0, oauthTokenUrl.indexOf("/oauth/token"));
        }
        if (oauthAuthorizeUrl != null && oauthAuthorizeUrl.contains("/oauth/authorize")) {
            return oauthAuthorizeUrl.substring(0, oauthAuthorizeUrl.indexOf("/oauth/authorize"));
        }
        return "https://auth.openai.com";
    }

    private String resolveDeviceClientId() {
        if (oauthDeviceClientId != null && !oauthDeviceClientId.isBlank()) {
            return oauthDeviceClientId.trim();
        }
        if (oauthClientId != null && !oauthClientId.isBlank()) {
            return oauthClientId.trim();
        }
        return DEFAULT_CODEX_CLIENT_ID;
    }

    private String maskClientId(String clientId) {
        if (clientId == null || clientId.length() <= 10) {
            return "app_***";
        }
        return clientId.substring(0, 8) + "***" + clientId.substring(clientId.length() - 4);
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
        clearDeviceLogin(session);
    }

    private void clearDeviceLogin(HttpSession session) {
        session.removeAttribute(DEVICE_AUTH_ID_KEY);
        session.removeAttribute(DEVICE_USER_CODE_KEY);
        session.removeAttribute(DEVICE_INTERVAL_KEY);
        session.removeAttribute(DEVICE_EXPIRES_AT_KEY);
    }

    private boolean isConnected(String accountEmail, String expiresAt) {
        if (accountEmail == null || accountEmail.isBlank() || expiresAt == null || expiresAt.isBlank()) {
            return false;
        }
        try {
            return Instant.parse(expiresAt).isAfter(Instant.now());
        } catch (Exception ex) {
            return false;
        }
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
