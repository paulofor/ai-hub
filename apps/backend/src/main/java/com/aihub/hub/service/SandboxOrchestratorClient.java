package com.aihub.hub.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class SandboxOrchestratorClient {

    private static final Logger log = LoggerFactory.getLogger(SandboxOrchestratorClient.class);

    private final RestClient restClient;
    private final String jobsPath;

    public SandboxOrchestratorClient(
        RestClient sandboxOrchestratorRestClient,
        @Value("${hub.sandbox.orchestrator.jobs-path:/jobs}") String jobsPath
    ) {
        this.restClient = sandboxOrchestratorRestClient;
        this.jobsPath = jobsPath;
    }

    public SandboxOrchestratorJobResponse createJob(SandboxJobRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("jobId", request.jobId());
        Optional.ofNullable(request.repoSlug()).ifPresent(value -> body.put("repoSlug", value));
        Optional.ofNullable(request.repoUrl()).ifPresent(value -> body.put("repoUrl", value));
        body.put("branch", request.branch());
        body.put("taskDescription", request.taskDescription());
        Optional.ofNullable(request.commitHash()).ifPresent(value -> body.put("commit", value));
        Optional.ofNullable(request.testCommand()).ifPresent(value -> body.put("testCommand", value));

        log.info("Enviando job {} para sandbox-orchestrator no path {}", request.jobId(), jobsPath);
        JsonNode response = restClient.post()
            .uri(jobsPath)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(JsonNode.class);

        return SandboxOrchestratorJobResponse.from(response);
    }

    public SandboxOrchestratorJobResponse getJob(String jobId) {
        log.info("Consultando job {} no sandbox-orchestrator", jobId);
        JsonNode response = restClient.get()
            .uri(jobsPath + "/" + jobId)
            .retrieve()
            .body(JsonNode.class);
        return SandboxOrchestratorJobResponse.from(response);
    }

    public record SandboxOrchestratorJobResponse(
        String jobId,
        String status,
        String summary,
        List<String> changedFiles,
        String patch,
        String error
    ) {
        public static SandboxOrchestratorJobResponse from(JsonNode node) {
            if (node == null || node.isMissingNode()) {
                return null;
            }
            List<String> files = Optional.ofNullable(node.path("changedFiles"))
                .filter(JsonNode::isArray)
                .stream()
                .flatMap(array -> {
                    java.util.List<String> values = new java.util.ArrayList<>();
                    array.forEach(item -> {
                        String text = item.asText(null);
                        if (text != null && !text.isBlank()) {
                            values.add(text.trim());
                        }
                    });
                    return values.stream();
                })
                .toList();

            return new SandboxOrchestratorJobResponse(
                node.path("jobId").asText(null),
                node.path("status").asText(null),
                node.path("summary").asText(null),
                files.isEmpty() ? null : files,
                node.path("patch").asText(null),
                node.path("error").asText(null)
            );
        }
    }
}
