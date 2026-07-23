package com.aihub.hub.web;

import com.aihub.hub.domain.CodexInteractionRecord;
import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.dto.CodexDashboardMetrics;
import com.aihub.hub.dto.CodexRequestSummary;
import com.aihub.hub.dto.RateCodexRequest;
import com.aihub.hub.dto.SaveCodexCommentRequest;
import com.aihub.hub.dto.UpdatePendingCodexRequest;
import com.aihub.hub.service.CodexRequestService;
import com.aihub.hub.service.PullRequestService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientResponseException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@RestController
@RequestMapping("/api/codex/requests")
public class CodexController {

    private static final Pattern PULL_REQUEST_URL_PATTERN = Pattern.compile(
        "https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\\d+"
    );

    private final CodexRequestService codexRequestService;
    private final PullRequestService pullRequestService;
    private final ObjectMapper objectMapper;

    public CodexController(CodexRequestService codexRequestService, PullRequestService pullRequestService, ObjectMapper objectMapper) {
        this.codexRequestService = codexRequestService;
        this.pullRequestService = pullRequestService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public Object list(@RequestParam(required = false) Integer page,
                       @RequestParam(required = false) Integer size,
                       @RequestParam(required = false) Integer rating) {
        if (rating != null && (rating < 1 || rating > 5)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Rating deve estar entre 1 e 5");
        }

        if (page == null && size == null) {
            if (rating == null) {
                return codexRequestService.list();
            }
            return codexRequestService.list().stream()
                .filter(request -> rating.equals(request.getRating()))
                .toList();
        }
        int resolvedPage = page != null ? page : 0;
        int resolvedSize = size != null ? size : 5;
        Page<CodexRequestSummary> result = codexRequestService.listPage(resolvedPage, resolvedSize, rating);
        return result;
    }

    @GetMapping("/metrics")
    public CodexDashboardMetrics metrics() {
        return codexRequestService.dashboardMetrics();
    }

    @GetMapping("/{id}")
    public CodexRequest get(@PathVariable Long id) {
        return codexRequestService.find(id);
    }

    @PostMapping
    public CodexRequest create(@Valid @RequestBody CreateCodexRequest request) {
        return codexRequestService.create(request);
    }

    @GetMapping(value = "/{id}/interactions/download", produces = "application/zip")
    public ResponseEntity<byte[]> downloadInteractions(@PathVariable Long id) {
        List<CodexInteractionRecord> interactions = codexRequestService.listInteractions(id);
        CodexRequest request = codexRequestService.find(id);

        Map<String, Object> payload = new HashMap<>();
        payload.put("requestId", request.getId());
        payload.put("environment", request.getEnvironment());
        payload.put("model", request.getModel());
        payload.put("version", request.getVersion());
        payload.put("profile", request.getProfile());
        payload.put("createdAt", request.getCreatedAt());
        payload.put("envParameters", extractEnvParameters());
        int summarizedInteractionCount = request.getInteractionCount() != null
            ? Math.max(request.getInteractionCount(), interactions.size())
            : interactions.size();
        payload.put("interactionCount", summarizedInteractionCount);
        payload.put("interactions", interactions.stream().map(interaction -> {
            Map<String, Object> item = new HashMap<>();
            item.put("id", interaction.getId());
            item.put("sandboxInteractionId", interaction.getSandboxInteractionId());
            item.put("direction", interaction.getDirection());
            item.put("content", interaction.getContent());
            item.put("tokenCount", interaction.getTokenCount());
            item.put("sequence", interaction.getSequence());
            item.put("createdAt", interaction.getCreatedAt());
            return item;
        }).toList());

        byte[] jsonBytes;
        try {
            jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(payload);
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível gerar o JSON das interações", ex);
        }

        String jsonFileName = "solicitacao-" + id + "-interacoes.json";
        String zipFileName = "solicitacao-" + id + "-interacoes.zip";
        byte[] zipBytes = zipSingleEntry(jsonFileName, jsonBytes);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("application/zip"));
        headers.setContentDisposition(ContentDisposition.attachment()
            .filename(zipFileName, StandardCharsets.UTF_8)
            .build());
        headers.setContentLength(zipBytes.length);

        return new ResponseEntity<>(zipBytes, headers, HttpStatus.OK);
    }

    private Map<String, String> extractEnvParameters() {
        List<String> knownKeys = List.of(
            "CIFIX_MODEL",
            "CIFIX_MODEL_ECONOMY",
            "CIFIX_ECONOMY_MODEL",
            "OPENAI_MODEL",
            "OPENAI_API_URL",
            "TASK_DESCRIPTION_MAX_CHARS",
            "TOOL_OUTPUT_STRING_LIMIT",
            "TOOL_OUTPUT_SERIALIZED_LIMIT",
            "HTTP_TOOL_TIMEOUT_MS",
            "HTTP_TOOL_MAX_RESPONSE_CHARS",
            "ECONOMY_TASK_DESCRIPTION_MAX_CHARS",
            "ECONOMY_TOOL_OUTPUT_STRING_LIMIT",
            "ECONOMY_TOOL_OUTPUT_SERIALIZED_LIMIT",
            "ECONOMY_HTTP_TOOL_MAX_RESPONSE_CHARS",
            "SMART_ECONOMY_TASK_DESCRIPTION_MAX_CHARS",
            "SMART_ECONOMY_TOOL_OUTPUT_STRING_LIMIT",
            "SMART_ECONOMY_TOOL_OUTPUT_SERIALIZED_LIMIT",
            "SMART_ECONOMY_HTTP_TOOL_MAX_RESPONSE_CHARS",
            "ECO1_TASK_DESCRIPTION_MAX_CHARS",
            "ECO1_TOOL_OUTPUT_STRING_LIMIT",
            "ECO1_TOOL_OUTPUT_SERIALIZED_LIMIT",
            "ECO1_HTTP_TOOL_MAX_RESPONSE_CHARS",
            "ECO2_AUTO_COMPACT_TOKEN_LIMIT",
            "ECO2_HISTORY_TARGET_TOKENS",
            "ECO2_USER_MESSAGE_TOKEN_LIMIT",
            "ECO2_TOOL_OUTPUT_STRING_LIMIT",
            "ECO2_TOOL_OUTPUT_SERIALIZED_LIMIT",
            "ECO2_HTTP_TOOL_MAX_RESPONSE_CHARS",
            "ECO3_AUTO_COMPACT_TOKEN_LIMIT",
            "ECO3_HISTORY_TARGET_TOKENS",
            "ECO3_USER_MESSAGE_TOKEN_LIMIT",
            "ECO3_TOOL_OUTPUT_STRING_LIMIT",
            "ECO3_TOOL_OUTPUT_SERIALIZED_LIMIT",
            "ECO3_HTTP_TOOL_MAX_RESPONSE_CHARS",
            "DB_QUERY_TIMEOUT_MS",
            "DB_QUERY_MAX_ROWS"
        );

        Map<String, String> parameters = new LinkedHashMap<>();
        for (String key : knownKeys) {
            String value = System.getenv(key);
            if (value == null || value.isBlank()) {
                continue;
            }
            parameters.put(key, maskIfSensitive(key, value));
        }
        return parameters;
    }

    private String maskIfSensitive(String key, String value) {
        String upperKey = key.toUpperCase(Locale.ROOT);
        if (upperKey.contains("TOKEN")
            || upperKey.contains("PASSWORD")
            || upperKey.contains("SECRET")
            || upperKey.contains("KEY")) {
            return "***";
        }
        return value;
    }

    @PostMapping("/{id}/comment")
    public CodexRequest comment(@PathVariable Long id, @Valid @RequestBody SaveCodexCommentRequest request) {
        return codexRequestService.saveComment(id, request);
    }

    @PostMapping("/{id}/cancel")
    public CodexRequest cancel(@PathVariable Long id) {
        return codexRequestService.cancel(id);
    }

    @PostMapping("/batch/discard")
    public Map<String, Object> discardBatch(@RequestBody Map<String, Object> payload) {
        String environment = payload.get("environment") instanceof String value ? value : null;
        String workBatchKey = payload.get("workBatchKey") instanceof String value ? value : null;
        if (!StringUtils.hasText(workBatchKey) && payload.get("work_batch_key") instanceof String value) {
            workBatchKey = value;
        }
        String profileValue = payload.get("profile") instanceof String value ? value : null;
        CodexIntegrationProfile profile;
        try {
            profile = StringUtils.hasText(profileValue)
                ? CodexIntegrationProfile.valueOf(profileValue.trim().toUpperCase(Locale.ROOT).replace('-', '_'))
                : null;
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Perfil inválido para descartar lote");
        }
        return codexRequestService.discardBatch(environment, profile, workBatchKey);
    }

    @PatchMapping("/{id}")
    public CodexRequest updatePending(@PathVariable Long id, @Valid @RequestBody UpdatePendingCodexRequest request) {
        return codexRequestService.updatePendingBeforeDispatch(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deletePending(@PathVariable Long id) {
        codexRequestService.deletePendingBeforeDispatch(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/create-pr")
    public Map<String, Object> createPr(@PathVariable Long id,
                                        @RequestHeader(value = "X-Role", defaultValue = "viewer") String role,
                                        @RequestHeader(value = "X-User", defaultValue = "unknown") String actor) {
        assertOwner(role);
        CodexRequest request = codexRequestService.find(id);
        CodexRequestStatus status = Optional.ofNullable(request.getStatus()).orElse(CodexRequestStatus.PENDING);
        if (status != CodexRequestStatus.COMPLETED) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Só é possível criar PR para uma solicitação concluída com sucesso");
        }

        RepoCoordinates coordinates = RepoCoordinates.from(request.getEnvironment());
        if (coordinates == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ambiente da solicitação não está no formato owner/repo");
        }

        List<CodexRequest> batchRequests = codexRequestService.listBatch(request);
        Optional<String> existingBatchPr = batchRequests.stream()
            .map(CodexRequest::getPullRequestUrl)
            .filter(value -> value != null && !value.isBlank())
            .map(String::trim)
            .findFirst()
            .or(() -> batchRequests.stream()
                .map(CodexController::extractPullRequestUrl)
                .flatMap(Optional::stream)
                .findFirst());
        if (existingBatchPr.isPresent()) {
            String pullRequestUrl = existingBatchPr.get();
            codexRequestService.markPullRequestCreatedForBatch(request, pullRequestUrl);
            Map<String, Object> payload = new HashMap<>();
            payload.put("url", pullRequestUrl);
            payload.put("title", "AI Hub: lote Codex já possui PR");
            payload.put("createdAt", Instant.now().toString());
            return payload;
        }

        Optional<String> existingResponsePr = extractPullRequestUrl(request.getResponseText());
        if (existingResponsePr.isPresent()) {
            String pullRequestUrl = existingResponsePr.get();
            codexRequestService.markPullRequestCreatedForBatch(request, pullRequestUrl);
            Map<String, Object> payload = new HashMap<>();
            payload.put("url", pullRequestUrl);
            payload.put("title", "AI Hub: lote Codex já possui PR");
            payload.put("createdAt", Instant.now().toString());
            return payload;
        }

        if (request.getWorkBranch() != null && !request.getWorkBranch().isBlank()) {
            Optional<CodexRequest> activeBatchRequest = batchRequests.stream()
                .filter(item -> {
                    CodexRequestStatus itemStatus = Optional.ofNullable(item.getStatus()).orElse(CodexRequestStatus.PENDING);
                    return itemStatus == CodexRequestStatus.PENDING || itemStatus == CodexRequestStatus.RUNNING;
                })
                .findFirst();
            if (activeBatchRequest.isPresent()) {
                throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Ainda há solicitação pendente ou em execução no lote. Aguarde concluir antes de pedir PR."
                );
            }

            String baseBranch = extractBaseBranch(request.getEnvironment());
            PullRequestService.BranchPublicationReadiness readiness;
            try {
                readiness = pullRequestService.inspectBranchPublicationReadiness(
                    coordinates.owner(),
                    coordinates.repo(),
                    baseBranch,
                    request.getWorkBranch().trim()
                );
            } catch (RestClientResponseException ex) {
                HttpStatus responseStatus = ex.getStatusCode().is4xxClientError()
                    ? HttpStatus.BAD_REQUEST
                    : HttpStatus.BAD_GATEWAY;
                throw new ResponseStatusException(responseStatus, buildPullRequestErrorMessage(ex), ex);
            }
            if (readiness == null) {
                throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Não foi possível validar o diff funcional do lote antes de criar PR."
                );
            }
            if (!readiness.hasAnyDiff()) {
                throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Este lote não tem alteração para publicar. Envie uma implementação antes de pedir PR."
                );
            }
            if (!readiness.hasFunctionalDiff()) {
                throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Este lote contém apenas o diário obrigatório em docs/diario/registros1.md. Não há alteração funcional para publicar."
                );
            }

            String title = "AI Hub: lote Codex #" + request.getId();
            JsonNode pr;
            try {
                pr = pullRequestService.createDraftPrFromBranch(
                    actor,
                    coordinates.owner(),
                    coordinates.repo(),
                    baseBranch,
                    request.getWorkBranch().trim(),
                    title,
                    buildBatchPrExplanation(request, batchRequests)
                );
            } catch (RestClientResponseException ex) {
                HttpStatus responseStatus = ex.getStatusCode().is4xxClientError()
                    ? HttpStatus.BAD_REQUEST
                    : HttpStatus.BAD_GATEWAY;
                throw new ResponseStatusException(responseStatus, buildPullRequestErrorMessage(ex), ex);
            }
            String htmlUrl = pr != null && pr.hasNonNull("html_url") ? pr.get("html_url").asText() : null;
            Integer number = pr != null && pr.hasNonNull("number") ? pr.get("number").asInt() : null;
            codexRequestService.markPullRequestCreatedForBatch(request, htmlUrl);
            Map<String, Object> payload = new HashMap<>();
            payload.put("number", number);
            payload.put("url", htmlUrl);
            payload.put("title", title);
            payload.put("workBranch", request.getWorkBranch());
            payload.put("changedFiles", readiness.changedFiles());
            payload.put("functionalFiles", readiness.functionalFiles());
            payload.put("createdAt", Instant.now().toString());
            return payload;
        }

        ResponseRecord response = codexRequestService.findLatestResponseForEnvironment(request.getEnvironment())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nenhuma resposta encontrada na tabela responses para esta solicitação"));

        String diff = Optional.ofNullable(response.getUnifiedDiff())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Resposta encontrada não possui patch/unifiedDiff"));

        String title = "AI Hub: Correção da solicitação #" + request.getId();
        JsonNode pr = pullRequestService.createFixPr(
            actor,
            coordinates.owner(),
            coordinates.repo(),
            "main",
            title,
            diff,
            buildPrExplanation(request, response)
        );

        String htmlUrl = pr != null && pr.hasNonNull("html_url") ? pr.get("html_url").asText() : null;
        Integer number = pr != null && pr.hasNonNull("number") ? pr.get("number").asInt() : null;
        Map<String, Object> payload = new HashMap<>();
        payload.put("number", number);
        payload.put("url", htmlUrl);
        payload.put("title", title);
        payload.put("createdAt", Instant.now().toString());
        return payload;
    }

    private static Optional<String> extractPullRequestUrl(CodexRequest request) {
        if (request == null) {
            return Optional.empty();
        }
        return extractPullRequestUrl(request.getResponseText());
    }

    private static Optional<String> extractPullRequestUrl(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }
        Matcher matcher = PULL_REQUEST_URL_PATTERN.matcher(text);
        if (matcher.find()) {
            return Optional.of(matcher.group());
        }
        return Optional.empty();
    }

    private String buildPullRequestErrorMessage(RestClientResponseException ex) {
        String message = "GitHub recusou a criação do PR do lote";
        String responseBody = ex.getResponseBodyAsString();
        if (responseBody != null && !responseBody.isBlank()) {
            try {
                JsonNode node = objectMapper.readTree(responseBody);
                if (node.hasNonNull("message")) {
                    message += ": " + node.get("message").asText();
                }
            } catch (IOException ignored) {
                message += ": " + responseBody;
            }
        }
        return message;
    }

    private String extractBaseBranch(String environment) {
        if (environment != null) {
            int atIndex = environment.indexOf('@');
            if (atIndex >= 0 && atIndex + 1 < environment.length()) {
                String branch = environment.substring(atIndex + 1).trim();
                if (!branch.isBlank()) {
                    return branch;
                }
            }
            String[] parts = environment.trim().split("/");
            if (parts.length >= 3 && !parts[2].isBlank()) {
                return parts[2].trim();
            }
        }
        return "main";
    }

    private String buildBatchPrExplanation(CodexRequest request, List<CodexRequest> batchRequests) {
        StringBuilder body = new StringBuilder();
        body.append("Draft PR criado a partir da branch de trabalho acumulada do AI Hub.");
        if (request.getWorkBranch() != null && !request.getWorkBranch().isBlank()) {
            body.append("\n\nBranch de trabalho: `").append(request.getWorkBranch().trim()).append("`.");
        }
        if (batchRequests != null && !batchRequests.isEmpty()) {
            body.append("\n\nSolicitações incluídas:\n");
            batchRequests.forEach(item -> body
                .append("- #")
                .append(item.getId())
                .append(" - ")
                .append(Optional.ofNullable(item.getStatus()).map(Enum::name).orElse("PENDING"))
                .append("\n"));
        }
        body.append("\nEste fluxo preserva várias solicitações em uma única branch até o usuário pedir PR.");
        return body.toString();
    }

    private String buildPrExplanation(CodexRequest request, ResponseRecord response) {
        return Optional.ofNullable(request.getResponseText())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .or(() -> Optional.ofNullable(response.getFixPlan())
                .map(String::trim)
                .filter(value -> !value.isBlank()))
            .orElse("PR criado a partir da resposta final registrada pelo AI Hub.");
    }

    private byte[] zipSingleEntry(String entryName, byte[] data) {
        try (ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
             ZipOutputStream zipOutputStream = new ZipOutputStream(byteArrayOutputStream, StandardCharsets.UTF_8)) {
            zipOutputStream.putNextEntry(new ZipEntry(entryName));
            zipOutputStream.write(data);
            zipOutputStream.closeEntry();
            zipOutputStream.finish();
            return byteArrayOutputStream.toByteArray();
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível compactar as interações", ex);
        }
    }

    private void assertOwner(String role) {
        if (!"owner".equalsIgnoreCase(role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Ação requer confirmação de um owner");
        }
    }

    private record RepoCoordinates(String owner, String repo) {
        static RepoCoordinates from(String environment) {
            if (environment == null || environment.isBlank()) {
                return null;
            }
            String[] parts = environment.trim().split("/");
            if (parts.length < 2) {
                return null;
            }
            String repo = parts[1];
            int branchSeparator = repo.indexOf('@');
            if (branchSeparator >= 0) {
                repo = repo.substring(0, branchSeparator);
            }
            if (repo.isBlank()) {
                return null;
            }
            return new RepoCoordinates(parts[0], repo);
        }
    }

    @PostMapping("/{id}/rating")
    public CodexRequest rate(@PathVariable Long id, @Valid @RequestBody RateCodexRequest request) {
        return codexRequestService.rate(id, request);
    }
}
