package com.aihub.hub.service;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.repository.CodexRequestRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
public class CodexRequestService {

    private final CodexRequestRepository codexRequestRepository;
    private final String defaultModel;

    public CodexRequestService(CodexRequestRepository codexRequestRepository,
                               @Value("${hub.codex.model:gpt-5-codex}") String defaultModel) {
        this.codexRequestRepository = codexRequestRepository;
        this.defaultModel = defaultModel;
    }

    public CodexRequest create(CreateCodexRequest request) {
        String model = resolveModel(request.getModel());
        CodexRequest codexRequest = new CodexRequest(
            request.getEnvironment().trim(),
            model,
            request.getPrompt().trim()
        );
        return codexRequestRepository.save(codexRequest);
    }

    public List<CodexRequest> list() {
        return codexRequestRepository.findAllByOrderByCreatedAtDesc();
    }

    private String resolveModel(String candidate) {
        if (StringUtils.hasText(candidate)) {
            return candidate.trim();
        }
        return defaultModel;
    }
}
