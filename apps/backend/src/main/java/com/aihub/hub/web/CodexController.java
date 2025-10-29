package com.aihub.hub.web;

import com.aihub.hub.domain.CodexRequestRecord;
import com.aihub.hub.dto.CodexSubmissionRequest;
import com.aihub.hub.dto.CodexSubmissionResponse;
import com.aihub.hub.service.CodexService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/codex")
public class CodexController {

    private final CodexService codexService;

    public CodexController(CodexService codexService) {
        this.codexService = codexService;
    }

    @PostMapping("/requests")
    public CodexSubmissionResponse submit(@Valid @RequestBody CodexSubmissionRequest request) {
        CodexRequestRecord record = codexService.submitPrompt(request.prompt(), request.environment());
        return new CodexSubmissionResponse(
            record.getId(),
            record.getEnvironment(),
            record.getPrompt(),
            record.getResponse(),
            record.getCreatedAt()
        );
    }
}
