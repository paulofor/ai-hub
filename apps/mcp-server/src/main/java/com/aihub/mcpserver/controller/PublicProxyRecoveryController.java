package com.aihub.mcpserver.controller;

import com.aihub.mcpserver.model.PublicProxyRecoveryRequest;
import com.aihub.mcpserver.service.PublicProxyRecoveryClient;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/mcp/tools/recover-public-proxy")
public class PublicProxyRecoveryController {

    private final PublicProxyRecoveryClient client;

    public PublicProxyRecoveryController(PublicProxyRecoveryClient client) {
        this.client = client;
    }

    @PostMapping
    public ResponseEntity<JsonNode> submit(@Valid @RequestBody PublicProxyRecoveryRequest request) {
        return response(client.submit(request));
    }

    @GetMapping("/{requestId}")
    public ResponseEntity<JsonNode> status(@PathVariable UUID requestId) {
        return response(client.status(requestId));
    }

    private ResponseEntity<JsonNode> response(PublicProxyRecoveryClient.BackendResponse backend) {
        ResponseEntity.BodyBuilder response = ResponseEntity.status(backend.status())
                .contentType(MediaType.APPLICATION_JSON);
        if (backend.retryAfter() != null) {
            response.header(HttpHeaders.RETRY_AFTER, backend.retryAfter());
        }
        return response.body(backend.body());
    }
}
