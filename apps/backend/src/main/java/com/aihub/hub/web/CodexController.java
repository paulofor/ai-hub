package com.aihub.hub.web;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.service.CodexRequestService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/codex/requests")
public class CodexController {

    private final CodexRequestService codexRequestService;

    public CodexController(CodexRequestService codexRequestService) {
        this.codexRequestService = codexRequestService;
    }

    @GetMapping
    public List<CodexRequest> list() {
        return codexRequestService.list();
    }

    @PostMapping
    public CodexRequest create(@Valid @RequestBody CreateCodexRequest request) {
        return codexRequestService.create(request);
    }
}
