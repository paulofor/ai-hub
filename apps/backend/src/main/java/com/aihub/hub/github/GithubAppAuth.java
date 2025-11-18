package com.aihub.hub.github;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;

@Component
public class GithubAppAuth {

    private static final Logger log = LoggerFactory.getLogger(GithubAppAuth.class);

    private final RestClient githubRestClient;
    private final Clock clock;
    private final String appId;
    private final String privateKeyPem;
    private final String privateKeyFilePath;
    private final long installationId;

    private final AtomicReference<String> resolvedPrivateKeyPem = new AtomicReference<>();

    private final AtomicReference<CachedToken> cachedToken = new AtomicReference<>();

    public GithubAppAuth(RestClient githubRestClient,
                         Clock clock,
                         @Value("${hub.github.app-id}") String appId,
                         @Value("${GITHUB_PRIVATE_KEY_PEM:}") String privateKeyPem,
                         @Value("${GITHUB_PRIVATE_KEY_FILE:}") String privateKeyFilePath,
                         @Value("${hub.github.installation-id:}") String installationId) {
        this.githubRestClient = githubRestClient;
        this.clock = clock;
        this.appId = appId;
        this.privateKeyPem = privateKeyPem;
        this.privateKeyFilePath = privateKeyFilePath;
        this.installationId = parseInstallationId(installationId);
    }

    private long parseInstallationId(String installationId) {
        if (installationId == null) {
            return 0L;
        }
        String trimmed = installationId.trim();
        if (trimmed.isEmpty()) {
            return 0L;
        }
        try {
            return Long.parseLong(trimmed);
        } catch (NumberFormatException e) {
            throw new IllegalStateException("GitHub installation id must be numeric", e);
        }
    }

    public String createJwt() {
        String resolvedPem = resolvePrivateKeyPem();
        if (resolvedPem == null || resolvedPem.isBlank()) {
            log.error("GitHub App private key is empty. Configure GITHUB_PRIVATE_KEY_PEM, GITHUB_PRIVATE_KEY_FILE ou hub.github.private-key.");
            throw new IllegalStateException("GitHub App private key is empty");
        }

        log.info("Generating GitHub App JWT. appId={}, installationId={}, privateKeyConfigured={}, privateKeyLength={} chars",
            maskedAppId(), describeInstallationId(), hasConfiguredKeySource(), privateKeyLength(resolvedPem));

        try {
            Instant now = clock.instant();
            String headerJson = "{\"typ\":\"JWT\",\"alg\":\"RS256\"}";
            String header = Base64.getUrlEncoder().withoutPadding().encodeToString(headerJson.getBytes(StandardCharsets.UTF_8));
            long issuedAt = now.minusSeconds(30).getEpochSecond();
            long expiresAt = now.plus(9, ChronoUnit.MINUTES).getEpochSecond();
            String payload = String.format("{\"iat\":%d,\"exp\":%d,\"iss\":\"%s\"}", issuedAt, expiresAt, appId);
            String payloadB64 = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
            String signingInput = header + "." + payloadB64;
            byte[] signature = sign(signingInput.getBytes(StandardCharsets.UTF_8), resolvedPem);
            return signingInput + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
        } catch (Exception e) {
            log.error("Unable to generate GitHub App JWT. appId={}, installationId={}, privateKeyConfigured={}, privateKeyLength={} chars",
                maskedAppId(), describeInstallationId(), hasConfiguredKeySource(), privateKeyLength(resolvedPem), e);
            throw new IllegalStateException("Unable to generate GitHub App JWT", e);
        }
    }

    public String getInstallationToken() {
        CachedToken token = cachedToken.get();
        if (token != null && token.expiresAt.isAfter(clock.instant().plusSeconds(60))) {
            return token.token;
        }
        if (installationId <= 0) {
            throw new IllegalStateException("GitHub installation id is required");
        }
        log.info("Requesting GitHub installation token. appId={}, installationId={}.", maskedAppId(), describeInstallationId());

        try {
            String jwt = createJwt();
            JsonNode response = githubRestClient.post()
                .uri("/app/installations/{id}/access_tokens", installationId)
                .header("Authorization", "Bearer " + jwt)
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);
            String tokenValue = response.get("token").asText();
            Instant expiresAt = Instant.parse(response.get("expires_at").asText());
            CachedToken newToken = new CachedToken(tokenValue, expiresAt);
            cachedToken.set(newToken);
            return tokenValue;
        } catch (Exception ex) {
            log.error("Failed to obtain GitHub installation token. appId={}, installationId={}, privateKeyConfigured={}, privateKeyLength={} chars",
                maskedAppId(), describeInstallationId(), isPrivateKeyConfigured(), privateKeyLength(), ex);
            throw ex;
        }
    }

    public boolean verifySignature(String payload, String secret, String signatureHeader) {
        if (signatureHeader == null || !signatureHeader.startsWith("sha256=")) {
            return false;
        }
        try {
            byte[] expected = hmacSha256(secret, payload);
            byte[] provided = hexToBytes(signatureHeader.substring(7));
            return constantTimeEquals(expected, provided);
        } catch (Exception e) {
            log.warn("Error verifying webhook signature", e);
            return false;
        }
    }

    private byte[] sign(byte[] input, String resolvedPem) throws Exception {
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(loadPrivateKey(resolvedPem));
        signature.update(input);
        return signature.sign();
    }

    private PrivateKey loadPrivateKey(String resolvedPem) throws Exception {
        String sanitized = resolvedPem
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replaceAll("\\s", "");
        byte[] decoded = Base64.getDecoder().decode(sanitized);
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(decoded);
        return KeyFactory.getInstance("RSA").generatePrivate(spec);
    }

    private byte[] hmacSha256(String secret, String payload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
    }

    private byte[] hexToBytes(String hex) {
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                + Character.digit(hex.charAt(i + 1), 16));
        }
        return data;
    }

    private boolean constantTimeEquals(byte[] a, byte[] b) {
        if (a.length != b.length) {
            return false;
        }
        int result = 0;
        for (int i = 0; i < a.length; i++) {
            result |= a[i] ^ b[i];
        }
        return result == 0;
    }

    private boolean hasConfiguredKeySource() {
        return (privateKeyPem != null && !privateKeyPem.trim().isEmpty())
            || (privateKeyFilePath != null && !privateKeyFilePath.trim().isEmpty());
    }

    private String resolvePrivateKeyPem() {
        String cached = resolvedPrivateKeyPem.get();
        if (cached != null) {
            return cached;
        }

        String fromValue = normalize(privateKeyPem);
        if (fromValue != null) {
            resolvedPrivateKeyPem.compareAndSet(null, fromValue);
            return resolvedPrivateKeyPem.get();
        }

        String fromFile = loadKeyFromFile();
        if (fromFile != null) {
            resolvedPrivateKeyPem.compareAndSet(null, fromFile);
            return resolvedPrivateKeyPem.get();
        }

        return null;
    }

    private String loadKeyFromFile() {
        if (privateKeyFilePath == null || privateKeyFilePath.trim().isEmpty()) {
            return null;
        }
        try {
            String fileContent = Files.readString(Path.of(privateKeyFilePath)).trim();
            return fileContent.isBlank() ? null : fileContent;
        } catch (Exception e) {
            log.error("Failed to read GitHub App private key file at {}.", privateKeyFilePath, e);
            throw new IllegalStateException("Failed to read GitHub App private key file at " + privateKeyFilePath, e);
        }
    }

    private String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private int privateKeyLength(String pem) {
        return pem == null ? 0 : pem.length();
    }

    private String describeInstallationId() {
        return installationId > 0 ? String.valueOf(installationId) : "(missing)";
    }

    private String maskedAppId() {
        if (appId == null || appId.isBlank()) {
            return "(missing)";
        }
        String trimmed = appId.trim();
        if (trimmed.length() <= 4) {
            return "****" + trimmed;
        }
        return "****" + trimmed.substring(trimmed.length() - 4);
    }

    private record CachedToken(String token, Instant expiresAt) {
    }
}
