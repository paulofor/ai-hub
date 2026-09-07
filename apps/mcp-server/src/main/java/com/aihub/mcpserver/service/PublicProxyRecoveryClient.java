package com.aihub.mcpserver.service;

import com.aihub.mcpserver.config.McpServerProperties;
import com.aihub.mcpserver.model.PublicProxyRecoveryRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;

@Service
public class PublicProxyRecoveryClient {

    private static final String BACKEND_PATH = "/api/internal/operations/public-proxy-recoveries";

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public PublicProxyRecoveryClient(McpServerProperties properties, ObjectMapper objectMapper) {
        RestClient.Builder builder = RestClient.builder().baseUrl(properties.backendBaseUrl());
        if (StringUtils.hasText(properties.apiToken())) {
            builder.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + properties.apiToken());
        }
        this.restClient = builder.build();
        this.objectMapper = objectMapper;
    }

    public BackendResponse submit(PublicProxyRecoveryRequest request) {
        return restClient.post()
                .uri(BACKEND_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .exchange((ignored, response) -> readResponse(response.getStatusCode(), response.getHeaders(), response.getBody()));
    }

    public BackendResponse status(UUID requestId) {
        return restClient.get()
                .uri(BACKEND_PATH + "/{requestId}", requestId)
                .exchange((ignored, response) -> readResponse(response.getStatusCode(), response.getHeaders(), response.getBody()));
    }

    private BackendResponse readResponse(HttpStatusCode status, HttpHeaders headers, InputStream body)
            throws IOException {
        JsonNode json = body == null ? objectMapper.createObjectNode() : objectMapper.readTree(body);
        if (json == null) {
            json = objectMapper.createObjectNode();
        }
        return new BackendResponse(status, headers.getFirst(HttpHeaders.RETRY_AFTER), json);
    }

    public record BackendResponse(HttpStatusCode status, String retryAfter, JsonNode body) {
    }
}
