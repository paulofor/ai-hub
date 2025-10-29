package com.aihub.hub.service;

import com.aihub.hub.codex.CodexClient;
import com.aihub.hub.domain.CodexRequestRecord;
import com.aihub.hub.repository.CodexRequestRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CodexService {

    private final CodexClient codexClient;
    private final CodexRequestRepository codexRequestRepository;

    public CodexService(CodexClient codexClient, CodexRequestRepository codexRequestRepository) {
        this.codexClient = codexClient;
        this.codexRequestRepository = codexRequestRepository;
    }

    @Transactional
    public CodexRequestRecord submitPrompt(String prompt, String environment) {
        String response = codexClient.submitTask(prompt, environment);
        CodexRequestRecord record = new CodexRequestRecord(environment, prompt, response);
        return codexRequestRepository.save(record);
    }
}
