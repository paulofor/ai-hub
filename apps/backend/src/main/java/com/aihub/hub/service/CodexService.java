package com.aihub.hub.service;

import com.aihub.hub.codex.CodexClient;
import com.aihub.hub.domain.CodexRequestRecord;
import com.aihub.hub.dto.CodexRequestView;
import com.aihub.hub.dto.CodexSubmissionRequest;
import com.aihub.hub.dto.CodexTaskResponse;
import com.aihub.hub.dto.CodexToolCall;
import com.aihub.hub.repository.CodexRequestRepository;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.ArrayList;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class CodexService {

    private static final Logger log = LoggerFactory.getLogger(CodexService.class);

    private final CodexClient codexClient;
    private final CodexRequestRepository codexRequestRepository;
    private final PullRequestService pullRequestService;
    private final SandboxProvisioningService sandboxProvisioningService;

    public CodexService(CodexClient codexClient,
                        CodexRequestRepository codexRequestRepository,
                        PullRequestService pullRequestService,
                        SandboxProvisioningService sandboxProvisioningService) {
        this.codexClient = codexClient;
        this.codexRequestRepository = codexRequestRepository;
        this.pullRequestService = pullRequestService;
        this.sandboxProvisioningService = sandboxProvisioningService;
    }

    @Transactional(readOnly = true)
    public List<CodexRequestView> listRequests() {
        return codexRequestRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt")).stream()
            .map(CodexRequestView::from)
            .toList();
    }

    @Transactional
    public CodexRequestView submitRequest(CodexSubmissionRequest request) {
        String sandboxSlug = sandboxProvisioningService.ensureSandbox(request.environment());
        CodexTaskResponse response = codexClient.submitTask(request.prompt(), sandboxSlug);
        CodexRequestRecord record = new CodexRequestRecord(sandboxSlug, codexClient.getModel(), request.prompt());
        String finalResponseText = mergeResponseWithActions(sandboxSlug, response);
        record.setResponseText(finalResponseText);
        record.setExternalId(response.id());
        CodexRequestRecord saved = codexRequestRepository.save(record);
        return CodexRequestView.from(saved);
    }

    private String mergeResponseWithActions(String environment, CodexTaskResponse response) {
        List<String> actionSummaries = executeToolCalls(environment, response.toolCalls());
        String baseContent = response.content();
        if (actionSummaries.isEmpty()) {
            return baseContent;
        }

        String actionsBlock = actionSummaries.stream()
            .filter(Objects::nonNull)
            .filter(summary -> !summary.isBlank())
            .map(summary -> "- " + summary.trim())
            .collect(Collectors.joining("\n"));

        StringBuilder builder = new StringBuilder();
        if (baseContent != null && !baseContent.isBlank()) {
            builder.append(baseContent.stripTrailing()).append("\n\n");
        }
        builder.append("Ações executadas automaticamente:\n").append(actionsBlock);
        return builder.toString();
    }

    private List<String> executeToolCalls(String environment, List<CodexToolCall> toolCalls) {
        if (toolCalls == null || toolCalls.isEmpty()) {
            return List.of();
        }

        List<String> summaries = new ArrayList<>();
        for (CodexToolCall call : toolCalls) {
            if (call == null) {
                continue;
            }

            String toolName = call.name();
            if (toolName == null) {
                continue;
            }

            switch (toolName) {
                case "create_merge_request":
                case "create_pull_request":
                case "make_pr":
                    summaries.add(handleCreateMergeRequest(environment, call.arguments()));
                    break;
                default:
                    log.warn("Tool call do Codex não suportado: {}", toolName);
            }
        }

        return summaries;
    }

    private String handleCreateMergeRequest(String environment, JsonNode arguments) {
        RepoCoordinates coordinates = parseEnvironment(environment);
        if (coordinates == null) {
            log.warn("Não foi possível determinar owner/repo a partir do ambiente: {}", environment);
            return "Falha ao abrir merge request: ambiente inválido.";
        }

        if (arguments == null || arguments.isMissingNode()) {
            log.warn("Tool call create_merge_request recebido sem argumentos");
            return "Falha ao abrir merge request: parâmetros ausentes.";
        }

        String baseBranch = readStringArgument(arguments, "base_branch", "baseBranch", "base");
        String title = readStringArgument(arguments, "title");
        String diff = readStringArgument(arguments, "diff", "patch", "unified_diff");

        if (diff == null || diff.isBlank()) {
            log.warn("Tool call create_merge_request ignorado por diff ausente");
            return "Falha ao abrir merge request: diff não informado.";
        }
        if (title == null || title.isBlank()) {
            log.warn("Tool call create_merge_request ignorado por título ausente");
            return "Falha ao abrir merge request: título não informado.";
        }
        if (baseBranch == null || baseBranch.isBlank()) {
            baseBranch = "main";
        }

        try {
            JsonNode pr = pullRequestService.createFixPr(
                "codex",
                coordinates.owner(),
                coordinates.repo(),
                baseBranch,
                title,
                diff
            );
            String url = pr.path("html_url").asText(null);
            String number = pr.path("number").asText(null);
            if (url != null && !url.isBlank()) {
                return "Merge request criado com sucesso: " + url;
            }
            if (number != null && !number.isBlank()) {
                return "Merge request #" + number + " criado com sucesso.";
            }
            return "Merge request criado com sucesso.";
        } catch (Exception ex) {
            log.error("Falha ao criar merge request via Codex", ex);
            return "Falha ao abrir merge request: " + ex.getMessage();
        }
    }

    private RepoCoordinates parseEnvironment(String environment) {
        if (environment == null || environment.isBlank()) {
            return null;
        }
        String trimmed = environment.trim();
        String[] parts = trimmed.split("/");
        if (parts.length < 2) {
            return null;
        }
        return new RepoCoordinates(parts[0], parts[1]);
    }

    private String readStringArgument(JsonNode node, String... fieldNames) {
        if (node == null || fieldNames == null) {
            return null;
        }
        for (String field : fieldNames) {
            if (field == null) {
                continue;
            }
            JsonNode valueNode = node.path(field);
            if (valueNode != null && !valueNode.isMissingNode() && !valueNode.isNull()) {
                String value = valueNode.asText(null);
                if (value != null && !value.isBlank()) {
                    return value;
                }
            }
        }
        return null;
    }

    private record RepoCoordinates(String owner, String repo) {
    }
}
