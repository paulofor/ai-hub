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

        String responseText = extractResponseText(outputNodeRoot);
        if (responseText == null) {
            log.info("Codex response missing expected text node. responsePath=<auto>, responsePayload={}", response);
            throw new IllegalStateException("Resposta do Codex malformada");
        }
        String id = response.path("id").asText(null);

        log.info("Resposta recebida do Codex. id={}, model={}.", id, model);
        log.info("Resumo da resposta do Codex: {}", summarizeContent(responseText));
        log.info("Codex response payload: {}", response.toString());
        log.info("Codex response content: {}", responseText);

        return new CodexTaskResponse(id, model, responseText);
    }

    private String extractResponseText(JsonNode outputNodeRoot) {
        if (outputNodeRoot == null || !outputNodeRoot.isArray() || outputNodeRoot.isEmpty()) {
            return null;
        }

        StringBuilder builder = new StringBuilder();

        for (JsonNode outputItem : outputNodeRoot) {
            if (outputItem == null || outputItem.isMissingNode()) {
                continue;
            }

            JsonNode directTextNode = outputItem.path("text");
            if (directTextNode != null && directTextNode.isTextual()) {
                appendWithSeparator(builder, directTextNode.asText());
            }

            JsonNode contentNode = outputItem.path("content");
            if (contentNode != null && contentNode.isArray()) {
                for (JsonNode contentItem : contentNode) {
                    JsonNode textNode = contentItem.path("text");
                    if (textNode != null && textNode.isTextual()) {
                        appendWithSeparator(builder, textNode.asText());
                    }
                }
            }
        }

        if (builder.length() == 0) {
            return null;
        }

        return builder.toString();
    }

    private void appendWithSeparator(StringBuilder builder, String value) {
        if (value == null || value.isBlank()) {
            return;
        }

        if (builder.length() > 0) {
            builder.append("\n");
        }

        builder.append(value);
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
