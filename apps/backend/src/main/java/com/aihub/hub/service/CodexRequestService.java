package com.aihub.hub.service;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.repository.CodexRequestRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class CodexRequestService {

    private static final Logger log = LoggerFactory.getLogger(CodexRequestService.class);

    private final CodexRequestRepository codexRequestRepository;
    private final String defaultModel;
    private final SandboxOrchestratorClient sandboxOrchestratorClient;
    private final String defaultBranch;

    public CodexRequestService(CodexRequestRepository codexRequestRepository,
                               SandboxOrchestratorClient sandboxOrchestratorClient,
                               @Value("${hub.codex.model:gpt-5-codex}") String defaultModel,
                               @Value("${hub.codex.default-branch:main}") String defaultBranch) {
        this.codexRequestRepository = codexRequestRepository;
        this.sandboxOrchestratorClient = sandboxOrchestratorClient;
        this.defaultModel = defaultModel;
        this.defaultBranch = defaultBranch;
    }

    public CodexRequest create(CreateCodexRequest request) {
        String model = resolveModel(request.getModel());
        log.info("Criando CodexRequest para ambiente {} com modelo {}", request.getEnvironment(), model);
        CodexRequest codexRequest = new CodexRequest(
            request.getEnvironment().trim(),
            model,
            request.getPrompt().trim()
        );

        CodexRequest saved = codexRequestRepository.save(codexRequest);
        log.info("CodexRequest {} salvo, enviando para sandbox se aplicável", saved.getId());
        dispatchToSandbox(saved);
        return saved;
    }

    public List<CodexRequest> list() {
        List<CodexRequest> requests = codexRequestRepository.findAllByOrderByCreatedAtDesc();
        requests.stream()
            .filter(request -> request.getExternalId() != null)
            .filter(request -> request.getResponseText() == null)
            .peek(request -> log.info("Atualizando CodexRequest {} a partir do sandbox", request.getId()))
            .forEach(this::refreshFromSandbox);
        return requests;
    }

    private String resolveModel(String candidate) {
        if (StringUtils.hasText(candidate)) {
            return candidate.trim();
        }
        return defaultModel;
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
