package com.aihub.hub.service;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpServletRequest;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Service
public class TokenLifecycleManager {
    private static final Logger log = LoggerFactory.getLogger(TokenLifecycleManager.class);

    public static final String ACCOUNT_EMAIL_KEY = "chatgpt_account_email";
    public static final String EXPIRES_AT_KEY = "chatgpt_expires_at";
    public static final String ACCESS_TOKEN_KEY = "chatgpt_access_token";
    public static final String REFRESH_TOKEN_KEY = "chatgpt_refresh_token";
    public static final String ID_TOKEN_KEY = "chatgpt_id_token";

    private static final long REFRESH_SKEW_SECONDS = 60;

    private final RestClient restClient;
    private final MeterRegistry meterRegistry;

    @Value("${hub.account.oauth.token-url:https://auth.openai.com/oauth/token}")
    private String oauthTokenUrl;
    @Value("${hub.account.oauth.client-id:}")
    private String oauthClientId;
    @Value("${hub.account.oauth.client-secret:}")
    private String oauthClientSecret;
    @Value("${hub.account.oauth.device-client-id:app_EMoamEEZ73f0CkXaXp7hrann}")
    private String oauthDeviceClientId;
    @Value("${hub.account.oauth.organization-id:}")
    private String oauthOrganizationId;

    public TokenLifecycleManager(MeterRegistry meterRegistry) {
        this.restClient = RestClient.builder().build();
        this.meterRegistry = meterRegistry;
    }

    public void refreshIfNeeded(HttpSession session) {
        String expiresAtRaw = asString(session.getAttribute(EXPIRES_AT_KEY));
        Instant expiresAt = parseInstant(expiresAtRaw);
        if (expiresAt == null || expiresAt.isAfter(Instant.now().plusSeconds(REFRESH_SKEW_SECONDS))) {
            return;
        }

        String refreshToken = asString(session.getAttribute(REFRESH_TOKEN_KEY));
        if (refreshToken == null || refreshToken.isBlank()) {
            markExpired(session);
            return;
        }

        Map<String, Object> response = refreshWithRetry(refreshToken.trim());
        meterRegistry.counter("oauth_token_refresh_total").increment();
        String accessToken = asString(response.get("access_token"));
        if (accessToken == null || accessToken.isBlank()) {
            markExpired(session);
            return;
        }

        Long expiresIn = asLong(response.get("expires_in"));
        session.setAttribute(ACCESS_TOKEN_KEY, accessToken.trim());
        session.setAttribute(EXPIRES_AT_KEY, Instant.now().plus(resolveTtlSeconds(expiresIn), ChronoUnit.SECONDS).toString());

        String rotatedRefreshToken = asString(response.get("refresh_token"));
        if (rotatedRefreshToken != null && !rotatedRefreshToken.isBlank()) {
            session.setAttribute(REFRESH_TOKEN_KEY, rotatedRefreshToken.trim());
        }

        String idToken = asString(response.get("id_token"));
        if (idToken != null && !idToken.isBlank()) {
            session.setAttribute(ID_TOKEN_KEY, idToken.trim());
        }
        log.info("OAuth access token renovado com sucesso");
    }

    public Optional<String> getValidAccessTokenFromCurrentSession() {
        return currentSession()
            .flatMap(session -> {
                refreshIfNeeded(session);
                String accessToken = asString(session.getAttribute(ACCESS_TOKEN_KEY));
                String expiresAtRaw = asString(session.getAttribute(EXPIRES_AT_KEY));
                Instant expiresAt = parseInstant(expiresAtRaw);
                if (accessToken == null || accessToken.isBlank() || expiresAt == null || !expiresAt.isAfter(Instant.now())) {
                    return Optional.empty();
                }
                return Optional.of(accessToken.trim());
            });
    }

    public Optional<String> getValidCodexApiTokenFromCurrentSession() {
        return currentSession()
            .flatMap(session -> {
                refreshIfNeeded(session);
                String idToken = asString(session.getAttribute(ID_TOKEN_KEY));
                String expiresAtRaw = asString(session.getAttribute(EXPIRES_AT_KEY));
                Instant expiresAt = parseInstant(expiresAtRaw);
                if (idToken == null || idToken.isBlank() || expiresAt == null || !expiresAt.isAfter(Instant.now())) {
                    return Optional.empty();
                }
                String clientId = resolveClientIdForTokenExchange(idToken.trim());
                if (clientId == null || clientId.isBlank()) {
                    log.warn("Não foi possível resolver client_id para token exchange Codex");
                    return Optional.empty();
                }
                try {
                    Map<String, Object> response = requestCodexApiToken(idToken.trim(), clientId);
                    String apiToken = asString(response.get("access_token"));
                    if (apiToken == null || apiToken.isBlank()) {
                        meterRegistry.counter("oauth_codex_api_token_exchange_failure_total").increment();
                        log.warn("Token exchange Codex não retornou access_token");
                        return Optional.empty();
                    }
                    meterRegistry.counter("oauth_codex_api_token_exchange_total").increment();
                    return Optional.of(apiToken.trim());
                } catch (RestClientException ex) {
                    meterRegistry.counter("oauth_codex_api_token_exchange_failure_total").increment();
                    log.warn("Falha no token exchange Codex; execução seguirá sem token derivado para o sandbox: {}", ex.getMessage());
                    return Optional.empty();
                }
            });
    }

    private Optional<HttpSession> currentSession() {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes == null) {
            return Optional.empty();
        }
        HttpServletRequest request = attributes.getRequest();
        return Optional.ofNullable(request.getSession(false));
    }

    private Map<String, Object> refreshWithRetry(String refreshToken) {
        RestClientException lastException = null;
        long[] waits = new long[]{0, 200, 500};
        for (long waitMs : waits) {
            if (waitMs > 0) {
                sleep(waitMs);
            }
            try {
                return requestTokenRefresh(refreshToken);
            } catch (RestClientException ex) {
                lastException = ex;
            }
        }
        throw lastException != null ? lastException : new IllegalStateException("Falha no refresh OAuth");
    }

    private Map<String, Object> requestTokenRefresh(String refreshToken) {
        return postTokenForm(buildTokenRefreshPayload(refreshToken));
    }

    Map<String, String> buildTokenRefreshPayload(String refreshToken) {
        Map<String, String> payload = new HashMap<>();
        payload.put("grant_type", "refresh_token");
        payload.put("refresh_token", refreshToken);
        payload.put("client_id", oauthClientId);
        payload.put("id_token_add_organizations", "true");
        addOrganizationId(payload);
        if (oauthClientSecret != null && !oauthClientSecret.isBlank()) {
            payload.put("client_secret", oauthClientSecret);
        }
        return payload;
    }

    private Map<String, Object> requestCodexApiToken(String idToken, String clientId) {
        return postTokenForm(buildCodexApiTokenExchangePayload(idToken, clientId));
    }

    Map<String, String> buildCodexApiTokenExchangePayload(String idToken, String clientId) {
        Map<String, String> payload = new HashMap<>();
        payload.put("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange");
        payload.put("client_id", clientId);
        payload.put("requested_token", "openai-api-key");
        payload.put("subject_token", idToken);
        payload.put("subject_token_type", "urn:ietf:params:oauth:token-type:id_token");
        addOrganizationId(payload);
        return payload;
    }

    private void addOrganizationId(Map<String, String> payload) {
        if (oauthOrganizationId != null && !oauthOrganizationId.isBlank()) {
            payload.put("organization_id", oauthOrganizationId.trim());
        }
    }

    private Map<String, Object> postTokenForm(Map<String, String> payload) {
        return restClient.post()
            .uri(oauthTokenUrl)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(toFormUrlEncoded(payload))
            .retrieve()
            .body(Map.class);
    }


    private String resolveClientIdForTokenExchange(String idToken) {
        String audience = resolveAudienceFromIdToken(idToken);
        if (audience != null && !audience.isBlank()) {
            return audience.trim();
        }
        if (oauthDeviceClientId != null && !oauthDeviceClientId.isBlank()) {
            return oauthDeviceClientId.trim();
        }
        return oauthClientId == null ? null : oauthClientId.trim();
    }

    private String resolveAudienceFromIdToken(String idToken) {
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) {
                return null;
            }
            String payload = new String(java.util.Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
            int audIndex = payload.indexOf("\"aud\"");
            if (audIndex < 0) {
                return null;
            }
            int colon = payload.indexOf(':', audIndex);
            if (colon < 0) {
                return null;
            }
            int quoteStart = payload.indexOf('\"', colon + 1);
            if (quoteStart < 0) {
                return null;
            }
            int quoteEnd = payload.indexOf('\"', quoteStart + 1);
            if (quoteEnd <= quoteStart) {
                return null;
            }
            return payload.substring(quoteStart + 1, quoteEnd);
        } catch (Exception ignored) {
            return null;
        }
    }

    private long resolveTtlSeconds(Long expiresIn) {
        if (expiresIn == null || expiresIn <= 0) {
            return 300;
        }
        return expiresIn;
    }

    private void markExpired(HttpSession session) {
        meterRegistry.counter("oauth_token_refresh_failure_total").increment();
        session.removeAttribute(ACCESS_TOKEN_KEY);
        session.removeAttribute(REFRESH_TOKEN_KEY);
        session.removeAttribute(ID_TOKEN_KEY);
        session.setAttribute(EXPIRES_AT_KEY, Instant.now().minusSeconds(1).toString());
    }

    private Instant parseInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (Exception ex) {
            return null;
        }
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

    private String asString(Object value) {
        return value instanceof String text ? text : null;
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

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Thread interrompida durante backoff de refresh", ex);
        }
    }
}
