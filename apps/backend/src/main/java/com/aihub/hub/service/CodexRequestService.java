package com.aihub.hub.service;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.PromptRecord;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.PromptRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class CodexRequestService {

    private static final Logger log = LoggerFactory.getLogger(CodexRequestService.class);

    private final CodexRequestRepository codexRequestRepository;
    private final PromptRepository promptRepository;
    private final String defaultModel;
    private final SandboxOrchestratorClient sandboxOrchestratorClient;
    private final String defaultBranch;

    public CodexRequestService(CodexRequestRepository codexRequestRepository,
                               PromptRepository promptRepository,
                               SandboxOrchestratorClient sandboxOrchestratorClient,
                               @Value("${hub.codex.model:gpt-5-codex}") String defaultModel,
                               @Value("${hub.codex.default-branch:main}") String defaultBranch) {
        this.codexRequestRepository = codexRequestRepository;
        this.promptRepository = promptRepository;
        this.sandboxOrchestratorClient = sandboxOrchestratorClient;
        this.defaultModel = defaultModel;
        this.defaultBranch = defaultBranch;
    }

    @Transactional
    public CodexRequest create(CreateCodexRequest request) {
        String model = resolveModel(request.getModel());
        log.info("Criando CodexRequest para ambiente {} com modelo {}", request.getEnvironment(), model);
        CodexRequest codexRequest = new CodexRequest(
            request.getEnvironment().trim(),
            model,
            request.getPrompt().trim()
        );

        PromptMetadata metadata = extractMetadata(request.getEnvironment());
        PromptRecord promptRecord = new PromptRecord(
            metadata.repo(),
            metadata.branch(),
            metadata.runId(),
            metadata.prNumber(),
            model,
            request.getPrompt().trim()
        );
        promptRepository.save(promptRecord);

        CodexRequest saved = codexRequestRepository.save(codexRequest);
        log.info("CodexRequest {} salvo, enviando para sandbox se aplicável", saved.getId());
        dispatchToSandbox(saved);
        return saved;
    }

    public List<CodexRequest> list() {
        Instant refreshCutoff = Instant.now().minus(Duration.ofHours(1));
        List<CodexRequest> requests = codexRequestRepository.findAllByOrderByCreatedAtDesc();
        requests.stream()
            .filter(request -> request.getExternalId() != null)
            .filter(request -> request.getResponseText() == null)
            .filter(request -> shouldRefresh(request, refreshCutoff))
            .peek(request -> log.info("Atualizando CodexRequest {} a partir do sandbox", request.getId()))
            .forEach(this::refreshFromSandbox);
        return requests;
    }

    private boolean shouldRefresh(CodexRequest request, Instant refreshCutoff) {
        if (request.getCreatedAt() == null) {
            return false;
        }
        boolean withinAllowedWindow = request.getCreatedAt().isAfter(refreshCutoff);
        if (!withinAllowedWindow) {
            log.info(
                "Ignorando atualização do CodexRequest {} pois ultrapassou a janela de 1 hora (criado em {})",
                request.getId(),
                request.getCreatedAt()
            );
        }
        return withinAllowedWindow;
    }

    private String resolveModel(String candidate) {
        if (StringUtils.hasText(candidate)) {
            return candidate.trim();
        }
        return defaultModel;
    }

    private PromptMetadata extractMetadata(String environment) {
        RepoCoordinates coordinates = RepoCoordinates.from(environment);
        String repo = coordinates != null
            ? coordinates.owner() + "/" + coordinates.repo()
            : Optional.ofNullable(environment).map(String::trim).filter(value -> !value.isBlank()).orElse("unknown");

        String branch = extractBranch(environment);
        Long runId = extractNumber(environment, "(?i)run[:/#]\\s*(\\d+)");
        Integer prNumber = Optional.ofNullable(extractNumber(environment, "(?i)pr[:/#]\\s*(\\d+)")).map(Long::intValue).orElse(null);

        return new PromptMetadata(repo, branch, runId, prNumber);
    }

    private String extractBranch(String environment) {
        if (!StringUtils.hasText(environment)) {
            return defaultBranch;
        }
        Matcher matcher = Pattern.compile("@([\\w./-]+)").matcher(environment);
        if (matcher.find()) {
            return matcher.group(1).trim();
        }

        String[] parts = environment.trim().split("/");
        if (parts.length >= 3 && StringUtils.hasText(parts[2])) {
            return parts[2].trim();
        }

        return defaultBranch;
    }

    private Long extractNumber(String environment, String pattern) {
        if (!StringUtils.hasText(environment)) {
            return null;
        }
        Matcher matcher = Pattern.compile(pattern).matcher(environment);
        if (matcher.find()) {
            try {
                return Long.parseLong(matcher.group(1));
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private void dispatchToSandbox(CodexRequest request) {
        RepoCoordinates coordinates = RepoCoordinates.from(request.getEnvironment());
        if (coordinates == null) {
            log.info("Ambiente {} não corresponde a um repositório; ignorando envio para o sandbox", request.getEnvironment());
            return;
        }

        String jobId = UUID.randomUUID().toString();
        log.info("Enviando CodexRequest {} para sandbox com jobId {} e branch padrão {}", request.getId(), jobId, defaultBranch);
        SandboxJobRequest jobRequest = new SandboxJobRequest(
            jobId,
            coordinates.owner() + "/" + coordinates.repo(),
            null,
            defaultBranch,
            request.getPrompt(),
            null,
            null
        );

        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response = sandboxOrchestratorClient.createJob(jobRequest);
        log.info("Sandbox retornou resposta para CodexRequest {} com jobId {}", request.getId(), response != null ? response.jobId() : jobId);
        String resolvedExternalId = Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::jobId)
            .orElse(jobId);
        request.setExternalId(resolvedExternalId);
        Optional.ofNullable(response)
            .map(SandboxOrchestratorClient.SandboxOrchestratorJobResponse::summary)
            .ifPresent(request::setResponseText);

        codexRequestRepository.save(request);
        log.info("CodexRequest {} atualizado com externalId {}", request.getId(), resolvedExternalId);
    }

    private void refreshFromSandbox(CodexRequest request) {
        SandboxOrchestratorClient.SandboxOrchestratorJobResponse response =
            sandboxOrchestratorClient.getJob(request.getExternalId());
        if (response == null) {
            log.info("Nenhuma resposta encontrada no sandbox para CodexRequest {} com externalId {}", request.getId(), request.getExternalId());
            return;
        }

        boolean updated = false;
        if (response.summary() != null && !response.summary().isBlank()) {
            log.info("Sandbox retornou resumo para CodexRequest {}", request.getId());
            request.setResponseText(response.summary().trim());
            updated = true;
        }
        if (response.error() != null && !response.error().isBlank()) {
            log.info("Sandbox retornou erro para CodexRequest {}", request.getId());
            request.setResponseText(response.error().trim());
            updated = true;
        }

        if (updated) {
            codexRequestRepository.save(request);
            log.info("CodexRequest {} atualizado a partir do sandbox", request.getId());
        }
    }

    private record PromptMetadata(String repo, String branch, Long runId, Integer prNumber) {}

    private record RepoCoordinates(String owner, String repo) {
        static RepoCoordinates from(String environment) {
            if (environment == null || environment.isBlank()) {
                return null;
            }
            String[] parts = environment.trim().split("/");
            if (parts.length < 2) {
                return null;
            }
            return new RepoCoordinates(parts[0], parts[1]);
        }
    }
}
