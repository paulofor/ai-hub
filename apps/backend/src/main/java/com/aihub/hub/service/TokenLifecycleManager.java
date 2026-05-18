package com.aihub.hub.service;

import jakarta.servlet.http.HttpSession;
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

@Service
public class TokenLifecycleManager {

    public static final String ACCOUNT_EMAIL_KEY = "chatgpt_account_email";
    public static final String EXPIRES_AT_KEY = "chatgpt_expires_at";
    public static final String ACCESS_TOKEN_KEY = "chatgpt_access_token";
    public static final String REFRESH_TOKEN_KEY = "chatgpt_refresh_token";
    public static final String ID_TOKEN_KEY = "chatgpt_id_token";

    private static final long REFRESH_SKEW_SECONDS = 60;

    private final RestClient restClient;

    @Value("${hub.account.oauth.token-url:https://auth.openai.com/oauth/token}")
    private String oauthTokenUrl;
    @Value("${hub.account.oauth.client-id:}")
    private String oauthClientId;
    @Value("${hub.account.oauth.client-secret:}")
    private String oauthClientSecret;

    public TokenLifecycleManager() {
        this.restClient = RestClient.builder().build();
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
        Map<String, String> payload = new HashMap<>();
        payload.put("grant_type", "refresh_token");
        payload.put("refresh_token", refreshToken);
        payload.put("client_id", oauthClientId);
        if (oauthClientSecret != null && !oauthClientSecret.isBlank()) {
            payload.put("client_secret", oauthClientSecret);
        }
        return restClient.post()
            .uri(oauthTokenUrl)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(toFormUrlEncoded(payload))
            .retrieve()
            .body(Map.class);
    }

    private long resolveTtlSeconds(Long expiresIn) {
        if (expiresIn == null || expiresIn <= 0) {
            return 300;
        }
        return expiresIn;
    }

    private void markExpired(HttpSession session) {
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
