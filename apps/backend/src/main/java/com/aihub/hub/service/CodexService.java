package com.aihub.hub.service;

import com.aihub.hub.codex.CodexClient;
import com.aihub.hub.domain.CodexRequestRecord;
import com.aihub.hub.dto.CodexRequestView;
import com.aihub.hub.dto.CodexSubmissionRequest;
import com.aihub.hub.dto.CodexTaskResponse;
import com.aihub.hub.repository.CodexRequestRepository;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class CodexService {

    private final CodexClient codexClient;
    private final CodexRequestRepository codexRequestRepository;

    public CodexService(CodexClient codexClient, CodexRequestRepository codexRequestRepository) {
        this.codexClient = codexClient;
        this.codexRequestRepository = codexRequestRepository;
    }

    @Transactional(readOnly = true)
    public List<CodexRequestView> listRequests() {
        return codexRequestRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt")).stream()
            .map(CodexRequestView::from)
            .toList();
    }

    @Transactional
    public CodexRequestView submitRequest(CodexSubmissionRequest request) {
        CodexTaskResponse response = codexClient.submitTask(request.prompt(), request.environment());
        CodexRequestRecord record = new CodexRequestRecord(request.environment(), codexClient.getModel(), request.prompt());
        record.setResponseText(response.content());
        record.setExternalId(response.id());
        CodexRequestRecord saved = codexRequestRepository.save(record);
        return CodexRequestView.from(saved);
    }
}
