package com.aihub.hub.codex;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.Map;

@Component
public class CodexClient {

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final String apiKey;

    public CodexClient(@Qualifier("codexRestClient") RestClient restClient,
                       ObjectMapper objectMapper,
                       @Value("${hub.codex.api-key:}") String apiKey) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.apiKey = apiKey;
    }

    public String submitTask(String prompt, String environment) {
        Map<String, Object> body = new HashMap<>();
        body.put("prompt", prompt);
        body.put("environment", environment);

        RestClient.RequestBodySpec request = restClient.post()
            .uri("/api/tasks")
            .contentType(MediaType.APPLICATION_JSON)
            .body(body);

        if (apiKey != null && !apiKey.isBlank()) {
            request = request.header("Authorization", "Bearer " + apiKey);
        }

        String responseBody = request.retrieve().body(String.class);
        if (responseBody == null || responseBody.isBlank()) {
            return "";
        }

        try {
            JsonNode json = objectMapper.readTree(responseBody);
            return json.toPrettyString();
        } catch (JsonProcessingException e) {
            return responseBody;
        }
    }
}
