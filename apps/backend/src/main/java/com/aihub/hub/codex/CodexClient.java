package com.aihub.hub.codex;

import com.aihub.hub.dto.CodexTaskResponse;
import com.aihub.hub.dto.CodexToolCall;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class CodexClient {

    private static final Logger log = LoggerFactory.getLogger(CodexClient.class);

    private final RestClient restClient;
    private final String apiKey;
    private final String model;
    private final ObjectMapper objectMapper;

    public CodexClient(RestClient codexRestClient,
                       ObjectMapper objectMapper,
                       @Value("${OPENAI_API_KEY:}") String apiKey,
                       @Value("${hub.codex.model:gpt-5-codex}") String model) {
        this.restClient = codexRestClient;
        this.objectMapper = objectMapper;
        this.apiKey = apiKey;
        this.model = model;
    }

    public String getModel() {
        return model;
    }

    public CodexTaskResponse submitTask(String prompt, String sandboxSlug) {
        List<Map<String, String>> baseMessages = List.of(
            Map.of(
                "role", "system",
                "content", "Você é o assistente Codex. Use o contexto do ambiente informado para responder com um plano de ação objetivo. Quando precisar aplicar uma correção de código, gere um diff unificado e chame a ferramenta create_merge_request para abrir um merge request no GitHub do ambiente informado (formato owner/repo)."
            ),
            Map.of(
                "role", "user",
                "content", buildUserMessage(prompt, sandboxSlug)
            )
        );

        Map<String, Object> metadata = Map.of(
            "source", "ai-hub",
            "environment", sandboxSlug
        );

        CodexApiCallResponse primaryResponse = callCodex(baseMessages, metadata, sandboxSlug, 1);

        if (!primaryResponse.toolCalls().isEmpty()) {
            return new CodexTaskResponse(primaryResponse.id(), model, primaryResponse.content(), primaryResponse.toolCalls());
        }

        log.warn("Resposta do Codex sem tool calls. Enviando solicitação de reforço para gerar diff.");

        List<Map<String, String>> retryMessages = new ArrayList<>(baseMessages);
        if (primaryResponse.content() != null && !primaryResponse.content().isBlank()) {
            retryMessages.add(Map.of(
                "role", "assistant",
                "content", primaryResponse.content()
            ));
        }
        retryMessages.add(Map.of(
            "role", "user",
            "content", buildDiffReminder(sandboxSlug)
        ));

        CodexApiCallResponse retryResponse = callCodex(retryMessages, metadata, sandboxSlug, 2);

        String combinedContent = combineContents(primaryResponse.content(), retryResponse.content());
        List<CodexToolCall> finalToolCalls = !retryResponse.toolCalls().isEmpty()
            ? retryResponse.toolCalls()
            : primaryResponse.toolCalls();
        String finalId = retryResponse.id() != null ? retryResponse.id() : primaryResponse.id();

        return new CodexTaskResponse(finalId, model, combinedContent, finalToolCalls);
    }

    private CodexApiCallResponse callCodex(List<Map<String, String>> inputMessages,
                                           Map<String, Object> metadata,
                                           String sandboxSlug,
                                           int attempt) {
        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("input", inputMessages);
        body.put("metadata", metadata);
        body.put("tools", buildToolsDefinition());

        log.info("Enviando solicitação ao Codex (tentativa {}). model={}, environment={}.", attempt, model, sandboxSlug);
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

        List<CodexToolCall> toolCalls = extractToolCalls(outputNodeRoot);
        String responseText = extractResponseText(outputNodeRoot);
        if (responseText == null) {
            log.info("Codex response missing expected text node. responsePath=<auto>, responsePayload={}", response);
            throw new IllegalStateException("Resposta do Codex malformada");
        }
        String id = response.path("id").asText(null);

        log.info("Resposta recebida do Codex. id={}, model={}, tentativa={}.", id, model, attempt);
        log.info("Resumo da resposta do Codex: {}", summarizeContent(responseText));
        log.info("Codex response payload: {}", response.toString());
        log.info("Codex response content: {}", responseText);
        if (!toolCalls.isEmpty()) {
            log.info("Codex tool calls detected: {}", toolCalls);
        }

        return new CodexApiCallResponse(id, responseText, toolCalls);
    }

    private String combineContents(String primary, String retry) {
        if (primary == null || primary.isBlank()) {
            return retry;
        }
        if (retry == null || retry.isBlank()) {
            return primary;
        }
        if (primary.strip().equals(retry.strip())) {
            return primary;
        }
        return primary.stripTrailing() + "\n\n" + retry.strip();
    }

    private String buildDiffReminder(String sandboxSlug) {
        StringBuilder reminder = new StringBuilder();
        reminder.append("Sua resposta anterior não gerou nenhum diff ou chamada de ferramenta. ");
        reminder.append("Revise a tarefa solicitada e produza um diff unificado contendo somente as alterações necessárias. ");
        reminder.append("Em seguida, chame a ferramenta create_merge_request com os campos base_branch (use 'main' se não souber), title e diff. ");
        reminder.append("Lembre-se de que o diff deve ser aplicável ao repositório ").append(sandboxSlug).append(".");
        return reminder.toString();
    }

    private record CodexApiCallResponse(String id, String content, List<CodexToolCall> toolCalls) {
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

    private List<CodexToolCall> extractToolCalls(JsonNode outputNodeRoot) {
        if (outputNodeRoot == null || !outputNodeRoot.isArray()) {
            return List.of();
        }

        List<CodexToolCall> toolCalls = new ArrayList<>();

        for (JsonNode outputItem : outputNodeRoot) {
            if (outputItem == null || outputItem.isMissingNode()) {
                continue;
            }

            String type = outputItem.path("type").asText(null);
            if (!"tool_call".equals(type)) {
                continue;
            }

            String name = firstNonBlank(outputItem.path("name").asText(null), outputItem.path("tool_name").asText(null));
            if (name == null || name.isBlank()) {
                continue;
            }

            JsonNode argumentsNode = extractArgumentsNode(outputItem);
            if (argumentsNode == null || argumentsNode.isMissingNode() || argumentsNode instanceof NullNode) {
                log.warn("Codex tool call '{}' ignorado por falta de argumentos", name);
                continue;
            }

            toolCalls.add(new CodexToolCall(name, argumentsNode));
        }

        return List.copyOf(toolCalls);
    }

    private JsonNode extractArgumentsNode(JsonNode outputItem) {
        JsonNode argumentsNode = outputItem.path("arguments");
        if (argumentsNode != null && !argumentsNode.isMissingNode() && !argumentsNode.isNull()) {
            if (argumentsNode.isTextual()) {
                return parseArgumentsText(argumentsNode.asText());
            }
            return argumentsNode;
        }

        String argumentsText = outputItem.path("argument").asText(null);
        if (argumentsText != null && !argumentsText.isBlank()) {
            return parseArgumentsText(argumentsText);
        }

        JsonNode contentNode = outputItem.path("content");
        if (contentNode != null && contentNode.isArray()) {
            for (JsonNode contentItem : contentNode) {
                JsonNode nestedArguments = contentItem.path("arguments");
                if (nestedArguments != null && !nestedArguments.isMissingNode() && !nestedArguments.isNull()) {
                    if (nestedArguments.isTextual()) {
                        return parseArgumentsText(nestedArguments.asText());
                    }
                    return nestedArguments;
                }
            }
        }

        return null;
    }

    private JsonNode parseArgumentsText(String rawArguments) {
        if (rawArguments == null || rawArguments.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(rawArguments);
        } catch (IOException ex) {
            log.warn("Não foi possível interpretar os argumentos do tool call do Codex", ex);
            return null;
        }
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

    private String buildUserMessage(String prompt, String sandboxSlug) {
        StringBuilder builder = new StringBuilder();
        builder.append("Ambiente: ").append(sandboxSlug).append("\n\n");
        builder.append("Tarefa:\n").append(prompt.trim());
        return builder.toString();
    }

    private List<Map<String, Object>> buildToolsDefinition() {
        Map<String, Object> properties = Map.of(
            "base_branch", Map.of(
                "type", "string",
                "description", "Branch base para abrir o merge request"
            ),
            "title", Map.of(
                "type", "string",
                "description", "Título do merge request"
            ),
            "diff", Map.of(
                "type", "string",
                "description", "Diff no formato unified diff que deve ser aplicado"
            )
        );

        Map<String, Object> parameters = new HashMap<>();
        parameters.put("type", "object");
        parameters.put("properties", properties);
        parameters.put("required", List.of("base_branch", "title", "diff"));

        Map<String, Object> tool = new HashMap<>();
        tool.put("type", "function");
        tool.put("name", "create_merge_request");
        tool.put("description", "Abre um merge request no GitHub aplicando o diff informado no repositório do ambiente.");
        tool.put("parameters", parameters);

        return List.of(tool);
    }

    private String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
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
