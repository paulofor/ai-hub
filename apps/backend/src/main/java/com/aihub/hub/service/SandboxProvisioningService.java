package com.aihub.hub.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;
import java.util.HashMap;

@Service
public class SandboxProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(SandboxProvisioningService.class);

    private final RestClient restClient;
    private final String ensureSandboxPath;
    private final String jobSubmissionPath;

    public SandboxProvisioningService(RestClient sandboxOrchestratorRestClient,
                                      @Value("${hub.sandbox.orchestrator.ensure-path:/api/v1/sandboxes/ensure}") String ensureSandboxPath,
                                      @Value("${hub.sandbox.orchestrator.jobs-path:/api/v1/jobs}") String jobSubmissionPath) {
        this.restClient = sandboxOrchestratorRestClient;
        this.ensureSandboxPath = ensureSandboxPath;
        this.jobSubmissionPath = jobSubmissionPath;
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

    public JsonNode submitJob(SandboxJobRequest request) {
        if (request == null || request.jobId() == null || request.jobId().isBlank()) {
            throw new IllegalArgumentException("JobId must not be blank");
        }
        if (request.repoUrl() == null || request.repoUrl().isBlank()) {
            throw new IllegalArgumentException("Repository URL must not be blank");
        }
        if (request.branch() == null || request.branch().isBlank()) {
            throw new IllegalArgumentException("Branch must not be blank");
        }
        if (request.task() == null || request.task().isBlank()) {
            throw new IllegalArgumentException("Task must not be blank");
        }

        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("jobId", request.jobId());
            requestBody.put("repoUrl", request.repoUrl());
            requestBody.put("branch", request.branch());
            requestBody.put("task", request.task());
            if (request.slug() != null && !request.slug().isBlank()) {
                requestBody.put("slug", request.slug());
            }
            if (request.language() != null && !request.language().isBlank()) {
                requestBody.put("language", request.language());
            }
            if (request.testCommand() != null && !request.testCommand().isBlank()) {
                requestBody.put("testCommand", request.testCommand());
            }

            log.info("Enviando job {} para o sandbox orchestrator.", request.jobId());
            return restClient.post()
                .uri(jobSubmissionPath)
                .contentType(MediaType.APPLICATION_JSON)
                .body(requestBody)
                .retrieve()
                .body(JsonNode.class);
        } catch (Exception ex) {
            log.error("Falha ao submeter job {} ao sandbox orchestrator.", request.jobId(), ex);
            return null;
        }
    }

    public JsonNode fetchJob(String jobId) {
        if (jobId == null || jobId.isBlank()) {
            throw new IllegalArgumentException("JobId must not be blank");
        }
        try {
            log.info("Consultando status do job {} no sandbox orchestrator.", jobId);
            return restClient.get()
                .uri(jobSubmissionPath + "/" + jobId)
                .retrieve()
                .body(JsonNode.class);
        } catch (Exception ex) {
            log.error("Falha ao consultar job {} no sandbox orchestrator", jobId, ex);
            return null;
        }
    }
}
