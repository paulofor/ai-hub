package com.aihub.hub.codex;

import com.aihub.hub.dto.CodexTaskResponse;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class CodexClient {

    private final RestClient restClient;
    private final String apiKey;
    private final String model;

    public CodexClient(RestClient codexRestClient,
                       @Value("${OPENAI_API_KEY:}") String apiKey,
                       @Value("${hub.codex.model:gpt-5-codex}") String model) {
        this.restClient = codexRestClient;
        this.apiKey = apiKey;
        this.model = model;
    }

    public String getModel() {
        return model;
    }

    public CodexTaskResponse submitTask(String prompt, String environment) {
        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("input", List.of(
            Map.of(
                "role", "system",
                "content", "Você é o assistente Codex. Use o contexto do ambiente informado para responder com um plano de ação objetivo."
            ),
            Map.of(
                "role", "user",
                "content", buildUserMessage(prompt, environment)
            )
        ));
        body.put("metadata", Map.of(
            "source", "ai-hub",
            "environment", environment
        ));

        JsonNode response = restClient.post()
            .uri("/v1/responses")
            .header("Authorization", "Bearer " + apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(JsonNode.class);

        if (response == null) {
            throw new IllegalStateException("Resposta do Codex vazia");
        }

        JsonNode outputNode = response.at("/output/0/content/0/text");
        if (outputNode == null || outputNode.isMissingNode()) {
            throw new IllegalStateException("Resposta do Codex malformada");
        }

        String responseText = outputNode.asText();
        String id = response.path("id").asText(null);

        return new CodexTaskResponse(id, model, responseText);
    }

    private String buildUserMessage(String prompt, String environment) {
        StringBuilder builder = new StringBuilder();
        builder.append("Ambiente: ").append(environment).append("\n\n");
        builder.append("Tarefa:\n").append(prompt.trim());
        return builder.toString();
    }
}
