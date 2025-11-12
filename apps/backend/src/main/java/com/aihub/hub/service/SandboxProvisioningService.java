package com.aihub.hub.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Service
public class SandboxProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(SandboxProvisioningService.class);

    private final RestClient restClient;
    private final String ensureSandboxPath;

    public SandboxProvisioningService(RestClient sandboxOrchestratorRestClient,
                                      @Value("${hub.sandbox.orchestrator.ensure-path:/api/v1/sandboxes/ensure}") String ensureSandboxPath) {
        this.restClient = sandboxOrchestratorRestClient;
        this.ensureSandboxPath = ensureSandboxPath;
    }

    public String ensureSandbox(String environmentSlug) {
        if (environmentSlug == null || environmentSlug.isBlank()) {
            throw new IllegalArgumentException("Environment slug must not be blank");
        }

        try {
            Map<String, String> requestBody = Map.of("slug", environmentSlug);
            log.info("Solicitando provisionamento de sandbox para slug '{}'.", environmentSlug);
            JsonNode response = restClient.post()
                .uri(ensureSandboxPath)
                .contentType(MediaType.APPLICATION_JSON)
                .body(requestBody)
                .retrieve()
                .body(JsonNode.class);

            if (response != null) {
                String provisionedSlug = response.path("slug").asText(null);
                if (provisionedSlug != null && !provisionedSlug.isBlank()) {
                    log.info("Sandbox provisionado com slug '{}'.", provisionedSlug);
                    return provisionedSlug;
                }
            }

            log.warn("Resposta do orquestrador sem slug. Usando slug original '{}'.", environmentSlug);
            return environmentSlug;
        } catch (Exception ex) {
            log.error("Falha ao garantir sandbox '{}' no orquestrador. Usando slug original.", environmentSlug, ex);
            return environmentSlug;
        }
    }
}
