package com.aihub.hub.openai;

import com.aihub.hub.dto.CiFix;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
public class OpenAIClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAIClient.class);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final String apiKey;
    private final String model;

    public OpenAIClient(RestClient openAiRestClient,
                        ObjectMapper objectMapper,
                        @Value("${OPENAI_API_KEY:}") String apiKey,
                        @Value("${hub.openai.model:gpt-4.1-mini}") String model) {
        this.restClient = openAiRestClient;
        this.objectMapper = objectMapper;
        this.apiKey = apiKey;
        this.model = model;
    }

    public String getModel() {
        return model;
    }

    public CiFix analyzeLogs(String prompt, Map<String, Object> metadata) {
        Map<String, Object> schema = Map.of(
            "type", "json_schema",
            "json_schema", Map.of(
                "name", "CiFix",
                "strict", true,
                "schema", Map.of(
                    "type", "object",
                    "properties", Map.of(
                        "root_cause", Map.of("type", "string"),
                        "fix_plan", Map.of("type", "string"),
                        "unified_diff", Map.of("type", "string"),
                        "confidence", Map.of("type", "number", "minimum", 0, "maximum", 1)
                    ),
                    "required", List.of("root_cause", "fix_plan", "unified_diff", "confidence"),
                    "additionalProperties", false
                )
            )
        );

        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("input", List.of(
            Map.of("role", "system", "content", "Você é um assistente DevOps que analisa falhas de CI/CD e retorna um plano estruturado."),
            Map.of("role", "user", "content", prompt)
        ));
        body.put("response_format", schema);
        if (metadata != null && !metadata.isEmpty()) {
            body.put("metadata", metadata);
        }

        log.info("Enviando solicitação ao OpenAI. model={}.", model);

        JsonNode response = restClient.post()
            .uri("/v1/responses")
            .header("Authorization", "Bearer " + apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(JsonNode.class);

        if (response == null) {
            throw new IllegalStateException("OpenAI response vazia");
        }

        String responseId = response.path("id").asText(null);
        log.info("Resposta recebida do OpenAI. id={}, model={}.", responseId, model);

        JsonNode output = response.at("/output/0/content/0/text");
        if (output == null || output.isMissingNode()) {
            throw new IllegalStateException("OpenAI response malformado");
        }
        try {
            return objectMapper.readValue(output.asText(), CiFix.class);
        } catch (Exception e) {
            throw new IllegalStateException("Falha ao converter resposta OpenAI", e);
        }
    }
}
