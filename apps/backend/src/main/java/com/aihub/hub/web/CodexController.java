package com.aihub.hub.web;

import com.aihub.hub.dto.CodexRequestView;
import com.aihub.hub.dto.CodexSubmissionRequest;
import com.aihub.hub.service.CodexService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/codex")
public class CodexController {

    private final CodexService codexService;

    public CodexController(CodexService codexService) {
        this.codexService = codexService;
    }

    @GetMapping("/requests")
    public List<CodexRequestView> listRequests() {
        return codexService.listRequests();
    }

    @PostMapping("/requests")
    public CodexRequestView submit(@Valid @RequestBody CodexSubmissionRequest request) {
        return codexService.submitRequest(request);
    }
}
