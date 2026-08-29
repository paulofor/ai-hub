package com.aihub.hub.web;

import com.aihub.hub.dto.PublicProxyRecoveryRequest;
import com.aihub.hub.dto.PublicProxyRecoveryView;
import com.aihub.hub.service.PublicProxyRecoveryCooldownException;
import com.aihub.hub.service.PublicProxyRecoveryDispatchException;
import com.aihub.hub.service.PublicProxyRecoveryService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.NoSuchElementException;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/internal/operations/public-proxy-recoveries")
public class PublicProxyRecoveryController {

    private final PublicProxyRecoveryService service;
    private final String apiToken;

    public PublicProxyRecoveryController(
        PublicProxyRecoveryService service,
        @Value("${hub.mcp.api-token:}") String apiToken
    ) {
        this.service = service;
        this.apiToken = apiToken == null ? "" : apiToken.trim();
    }

    @PostMapping
    public ResponseEntity<?> submit(
        @Valid @RequestBody PublicProxyRecoveryRequest request,
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization
    ) {
        authorize(authorization);
        try {
            PublicProxyRecoveryService.Submission submission = service.submit(request);
            return ResponseEntity.status(submission.created() ? HttpStatus.ACCEPTED : HttpStatus.OK)
                .body(submission.view());
        } catch (PublicProxyRecoveryCooldownException ex) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(ex.getRetryAfterSeconds()))
                .body(Map.of(
                    "error", ex.getMessage(),
                    "retryAfterSeconds", ex.getRetryAfterSeconds()
                ));
        } catch (PublicProxyRecoveryDispatchException ex) {
            throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Falha ao despachar recuperação " + ex.getRequestId()
            );
        } catch (IllegalStateException ex) {
            HttpStatus status = ex.getMessage().contains("não está habilitada")
                ? HttpStatus.SERVICE_UNAVAILABLE
                : HttpStatus.CONFLICT;
            throw new ResponseStatusException(status, ex.getMessage());
        }
    }

    @GetMapping("/{requestId}")
    public PublicProxyRecoveryView status(
        @PathVariable UUID requestId,
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization
    ) {
        authorize(authorization);
        try {
            return service.refresh(requestId);
        } catch (NoSuchElementException ex) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, ex.getMessage());
        }
    }

    private void authorize(String authorization) {
        if (apiToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Token MCP não configurado");
        }
        String expected = "Bearer " + apiToken;
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] actualBytes = (authorization == null ? "" : authorization).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expectedBytes, actualBytes)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Bearer MCP inválido");
        }
    }
}
