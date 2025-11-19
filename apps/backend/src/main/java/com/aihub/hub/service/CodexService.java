package com.aihub.hub.service;

import com.aihub.hub.codex.CodexClient;
import com.aihub.hub.domain.CodexRequestRecord;
import com.aihub.hub.dto.CodexRequestView;
import com.aihub.hub.dto.CodexSubmissionRequest;
import com.aihub.hub.dto.CodexTaskResponse;
import com.aihub.hub.dto.CodexToolCall;
import com.aihub.hub.dto.RepositoryFileView;
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
    private final RepositoryContextBuilder repositoryContextBuilder;
    private final RepositoryFileService repositoryFileService;

    private static final int MAX_FILE_REQUEST_CYCLES = 3;
    private static final int MAX_FILE_CONTENT_CHARS = 20000;
    private static final int MAX_APPENDED_CONTEXT_CHARS = 60000;
    private static final String FILE_TOOL_NAME = "request_repository_file";

    public CodexService(CodexClient codexClient,
                        CodexRequestRepository codexRequestRepository,
                        PullRequestService pullRequestService,
                        SandboxProvisioningService sandboxProvisioningService,
                        RepositoryContextBuilder repositoryContextBuilder,
                        RepositoryFileService repositoryFileService) {
        this.codexClient = codexClient;
        this.codexRequestRepository = codexRequestRepository;
        this.pullRequestService = pullRequestService;
        this.sandboxProvisioningService = sandboxProvisioningService;
        this.repositoryContextBuilder = repositoryContextBuilder;
        this.repositoryFileService = repositoryFileService;
    }

    @Transactional(readOnly = true)
    public List<CodexRequestView> listRequests() {
        return codexRequestRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt")).stream()
            .map(CodexRequestView::from)
            .toList();
    }

    @Transactional
    public CodexRequestView submitRequest(CodexSubmissionRequest request) {
        String requestedEnvironment = request.environment();
        String sandboxSlug = sandboxProvisioningService.ensureSandbox(requestedEnvironment);
        if (!Objects.equals(sandboxSlug, requestedEnvironment)) {
            log.info("Sandbox '{}' provisionado a partir do ambiente '{}'.", sandboxSlug, requestedEnvironment);
        }

        String repositoryContext = repositoryContextBuilder.build(requestedEnvironment);
        List<String> automationSummaries = new ArrayList<>();
        CodexTaskResponse response = codexClient.submitTask(request.prompt(), requestedEnvironment, repositoryContext);
        CodexTaskResponse finalResponse = resolveFileRequests(
            requestedEnvironment,
            request.prompt(),
            repositoryContext,
            response,
            automationSummaries
        );
        CodexRequestRecord record = new CodexRequestRecord(requestedEnvironment, codexClient.getModel(), request.prompt());
        String finalResponseText = mergeResponseWithActions(requestedEnvironment, finalResponse, automationSummaries);
        record.setResponseText(finalResponseText);
        record.setExternalId(finalResponse != null ? finalResponse.id() : null);
        CodexRequestRecord saved = codexRequestRepository.save(record);
        return CodexRequestView.from(saved);
    }

    private CodexTaskResponse resolveFileRequests(String environment,
                                                  String basePrompt,
                                                  String repositoryContext,
                                                  CodexTaskResponse initialResponse,
                                                  List<String> automationSummaries) {
        if (initialResponse == null) {
            return null;
        }

        CodexTaskResponse currentResponse = initialResponse;
        String sanitizedPrompt = basePrompt == null ? "" : basePrompt;
        StringBuilder appendedContext = new StringBuilder();

        for (int attempt = 0; attempt < MAX_FILE_REQUEST_CYCLES; attempt++) {
            List<RepositoryFileRequest> fileRequests = extractFileRequests(currentResponse.toolCalls());
            if (fileRequests.isEmpty()) {
                return currentResponse;
            }

            List<RepositoryFileView> fetchedFiles = fetchRequestedFiles(environment, fileRequests, automationSummaries);
            if (fetchedFiles.isEmpty()) {
                log.warn("Codex solicitou {} arquivo(s), mas nenhum pôde ser carregado automaticamente.", fileRequests.size());
                return currentResponse;
            }

            int previousLength = appendedContext.length();
            appendFilesToContext(appendedContext, fetchedFiles);
            if (appendedContext.length() == previousLength) {
                log.warn("Não foi possível anexar conteúdo dos arquivos solicitados ao prompt; mantendo resposta atual.");
                return currentResponse;
            }
            String augmentedPrompt = buildAugmentedPrompt(sanitizedPrompt, appendedContext.toString());
            log.info("Reenviando tarefa ao Codex com {} arquivo(s) adicionados automaticamente (tentativa {}).", fetchedFiles.size(), attempt + 2);
            currentResponse = codexClient.submitTask(augmentedPrompt, environment, repositoryContext);
        }

        log.warn("Limite de iterações ({}) para carregamento automático de arquivos atingido.", MAX_FILE_REQUEST_CYCLES);
        return currentResponse;
    }

    private List<RepositoryFileRequest> extractFileRequests(List<CodexToolCall> toolCalls) {
        if (toolCalls == null || toolCalls.isEmpty()) {
            return List.of();
        }

        List<RepositoryFileRequest> requests = new ArrayList<>();
        for (CodexToolCall call : toolCalls) {
            if (call == null || call.name() == null || !FILE_TOOL_NAME.equals(call.name())) {
                continue;
            }

            String path = readStringArgument(call.arguments(), "path", "file", "filepath");
            if (path == null || path.isBlank()) {
                log.warn("Tool call request_repository_file ignorado por caminho ausente.");
                continue;
            }
            String ref = readStringArgument(call.arguments(), "ref", "branch", "sha");
            requests.add(new RepositoryFileRequest(path.trim(), ref));
        }
        return requests;
    }

    private List<RepositoryFileView> fetchRequestedFiles(String environment,
                                                         List<RepositoryFileRequest> requests,
                                                         List<String> automationSummaries) {
        List<RepositoryFileView> files = new ArrayList<>();
        for (RepositoryFileRequest request : requests) {
            try {
                RepositoryFileView file = repositoryFileService.fetchFile(environment, request.path(), request.ref());
                files.add(file);
                automationSummaries.add(buildFileSuccessSummary(file));
            } catch (Exception ex) {
                log.warn("Falha ao buscar arquivo {} solicitado automaticamente pelo Codex", request.path(), ex);
                automationSummaries.add("Falha ao carregar o arquivo " + request.path() + ": " + ex.getMessage());
            }
        }
        return files;
    }

    private String buildFileSuccessSummary(RepositoryFileView file) {
        StringBuilder builder = new StringBuilder("Arquivo ").append(file.path());
        if (file.ref() != null && !file.ref().isBlank()) {
            builder.append(" (@").append(file.ref()).append(")");
        }
        builder.append(" compartilhado automaticamente com o Codex.");
        return builder.toString();
    }

    private void appendFilesToContext(StringBuilder builder, List<RepositoryFileView> files) {
        if (files == null || files.isEmpty()) {
            return;
        }
        for (RepositoryFileView file : files) {
            if (builder.length() >= MAX_APPENDED_CONTEXT_CHARS) {
                log.warn("Limite de contexto adicional atingido; arquivos extras serão ignorados.");
                return;
            }
            builder.append("Arquivo solicitado automaticamente: ").append(file.path());
            if (file.ref() != null && !file.ref().isBlank()) {
                builder.append(" (ref ").append(file.ref()).append(")");
            }
            builder.append("\n");
            String content = file.content();
            if (content == null || content.isBlank()) {
                builder.append("[Conteúdo indisponível ou arquivo binário]");
            } else {
                builder.append("```\n");
                builder.append(truncateContent(content));
                builder.append("\n```");
            }
            builder.append("\n\n");
            if (builder.length() >= MAX_APPENDED_CONTEXT_CHARS) {
                log.warn("Limite de contexto adicional atingido após anexar arquivo; os demais serão ignorados.");
                return;
            }
        }
    }

    private String truncateContent(String content) {
        if (content == null) {
            return "";
        }
        if (content.length() <= MAX_FILE_CONTENT_CHARS) {
            return content;
        }
        return content.substring(0, MAX_FILE_CONTENT_CHARS) + "\n...\n[conteúdo truncado automaticamente]";
    }

    private String buildAugmentedPrompt(String basePrompt, String appendix) {
        if (appendix == null || appendix.isBlank()) {
            return basePrompt;
        }
        String normalizedBase = basePrompt == null ? "" : basePrompt.stripTrailing();
        return normalizedBase + "\n\n" + appendix.stripLeading();
    }

    private String mergeResponseWithActions(String environment,
                                            CodexTaskResponse response,
                                            List<String> automationSummaries) {
        List<String> actionSummaries = new ArrayList<>();
        if (automationSummaries != null && !automationSummaries.isEmpty()) {
            actionSummaries.addAll(automationSummaries);
        }
        actionSummaries.addAll(executeToolCalls(environment, response == null ? null : response.toolCalls()));
        String baseContent = response == null ? null : response.content();
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
                case FILE_TOOL_NAME:
                    log.info("Tool call request_repository_file ignorado após automação.");
                    break;
                default:
                    log.warn("Tool call do Codex não suportado: {}", toolName);
            }
        }

        return summaries;
    }

    private String handleCreateMergeRequest(String environment, JsonNode arguments) {
        RepoCoordinates coordinates = RepoCoordinates.from(environment);
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

    private record RepositoryFileRequest(String path, String ref) {
    }
}
