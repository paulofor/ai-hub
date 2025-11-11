package com.aihub.hub.codex;

import com.aihub.hub.dto.CodexTaskResponse;
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

@Component
public class CodexClient {

    private static final Logger log = LoggerFactory.getLogger(CodexClient.class);

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
        List<Map<String, String>> inputMessages = List.of(
            Map.of(
                "role", "system",
                "content", "Você é o assistente Codex. Use o contexto do ambiente informado para responder com um plano de ação objetivo."
            ),
            Map.of(
                "role", "user",
                "content", buildUserMessage(prompt, environment)
            )
        );

        Map<String, Object> metadata = Map.of(
            "source", "ai-hub",
            "environment", environment
        );

        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("input", inputMessages);
        body.put("metadata", metadata);

        log.info("Enviando solicitação ao Codex. model={}, environment={}.", model, environment);
        log.info("Codex request messages: {}", inputMessages);
        log.info("Codex request metadata: {}", metadata);

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

        log.info("Codex response raw payload: {}", response);

        JsonNode outputNodeRoot = response.path("output");
        log.info("Codex response 'output' node: {}", outputNodeRoot);

        JsonNode firstContentNode = outputNodeRoot.path(0).path("content");
        log.info("Codex response first 'content' node: {}", firstContentNode);

        JsonNode outputNode = response.at("/output/0/content/0/text");
        if (outputNode == null || outputNode.isMissingNode()) {
            log.info("Codex response missing expected text node. responsePath=/output/0/content/0/text, responsePayload={}", response);
            throw new IllegalStateException("Resposta do Codex malformada");
        }

        String responseText = outputNode.asText();
        String id = response.path("id").asText(null);

        log.info("Resposta recebida do Codex. id={}, model={}.", id, model);
        log.info("Resumo da resposta do Codex: {}", summarizeContent(responseText));
        log.info("Codex response payload: {}", response.toString());
        log.info("Codex response content: {}", responseText);

        return new CodexTaskResponse(id, model, responseText);
    }

    private String buildUserMessage(String prompt, String environment) {
        StringBuilder builder = new StringBuilder();
        builder.append("Ambiente: ").append(environment).append("\n\n");
        builder.append("Tarefa:\n").append(prompt.trim());
        return builder.toString();
    }

    private String summarizeContent(String content) {
        if (content == null || content.isBlank()) {
            return "<vazio>";
        }

        String trimmed = content.strip();
        if (trimmed.length() <= 300) {
            return trimmed;
        }

        return trimmed.substring(0, 300) + "...";
    }
}
