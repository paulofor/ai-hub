package com.aihub.hub.service;

import org.slf4j.Logger;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Logs every backend exchange with OpenAI while redacting credentials and one-time codes.
 */
public final class OpenAiExchangeLogger {
    private static final String REDACTED = "[redacted]";

    private OpenAiExchangeLogger() {
    }

    public static void logRequest(Logger log, String operation, String method, String url, Map<?, ?> payload) {
        log.info(
            "OpenAI exchange outbound operation={} method={} url={} payload={}",
            operation,
            method,
            sanitizeUrl(url),
            sanitizeMap(payload)
        );
    }

    public static void logResponse(Logger log, String operation, Map<?, ?> response) {
        log.info(
            "OpenAI exchange inbound operation={} response={}",
            operation,
            sanitizeMap(response)
        );
    }

    public static void logError(Logger log, String operation, RestClientException ex) {
        if (ex instanceof HttpStatusCodeException httpEx) {
            log.warn(
                "OpenAI exchange error operation={} status={} responseBody={}",
                operation,
                httpEx.getStatusCode().value(),
                sanitizeText(httpEx.getResponseBodyAsString())
            );
            return;
        }
        log.warn("OpenAI exchange error operation={} error={}", operation, sanitizeText(ex.getMessage()));
    }

    public static String sanitizeUrl(String url) {
        if (url == null || url.isBlank()) {
            return url;
        }
        int queryStart = url.indexOf('?');
        if (queryStart < 0 || queryStart == url.length() - 1) {
            return url;
        }
        String base = url.substring(0, queryStart + 1);
        String[] pairs = url.substring(queryStart + 1).split("&");
        StringBuilder sanitized = new StringBuilder(base);
        for (int i = 0; i < pairs.length; i++) {
            if (i > 0) {
                sanitized.append('&');
            }
            String pair = pairs[i];
            int equals = pair.indexOf('=');
            if (equals < 0) {
                sanitized.append(pair);
                continue;
            }
            String key = pair.substring(0, equals);
            String value = pair.substring(equals + 1);
            sanitized.append(key).append('=').append(isSensitiveKey(key) ? REDACTED : value);
        }
        return sanitized.toString();
    }

    public static Map<String, Object> sanitizeMap(Map<?, ?> values) {
        Map<String, Object> sanitized = new LinkedHashMap<>();
        if (values == null) {
            return sanitized;
        }
        for (Map.Entry<?, ?> entry : values.entrySet()) {
            String key = String.valueOf(entry.getKey());
            Object value = entry.getValue();
            sanitized.put(key, sanitizeValue(key, value));
        }
        return sanitized;
    }

    private static Object sanitizeValue(String key, Object value) {
        if (value == null) {
            return null;
        }
        if (isSensitiveKey(key)) {
            return REDACTED;
        }
        if (value instanceof Map<?, ?> nested) {
            return sanitizeMap(nested);
        }
        if (value instanceof Iterable<?> iterable) {
            return sanitizeIterable(iterable);
        }
        if (value instanceof String text) {
            return sanitizeText(text);
        }
        return value;
    }

    private static Object sanitizeIterable(Iterable<?> iterable) {
        java.util.List<Object> sanitized = new java.util.ArrayList<>();
        for (Object value : iterable) {
            sanitized.add(value instanceof Map<?, ?> nested ? sanitizeMap(nested) : value);
        }
        return sanitized;
    }

    private static String sanitizeText(String value) {
        if (value == null) {
            return null;
        }
        String sanitized = value;
        sanitized = sanitized.replaceAll("(?i)(access_token|refresh_token|id_token|subject_token|client_secret|code_verifier|authorization_code|device_auth_id|user_code|usercode)\\\"?\\s*[:=]\\s*\\\"?[^\\\",&}\\s]+", "$1=" + REDACTED);
        sanitized = sanitized.replaceAll("(?i)(Bearer)\\s+[A-Za-z0-9._~+/-]+=*", "$1 " + REDACTED);
        return sanitized;
    }

    private static boolean isSensitiveKey(String key) {
        if (key == null) {
            return false;
        }
        String normalized = key.toLowerCase(Locale.ROOT);
        return normalized.contains("token")
            || normalized.contains("secret")
            || normalized.equals("code")
            || normalized.contains("authorization_code")
            || normalized.contains("code_verifier")
            || normalized.contains("code_challenge")
            || normalized.contains("device_auth_id")
            || normalized.contains("user_code")
            || normalized.contains("usercode")
            || normalized.equals("state");
    }
}
