package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.dto.CodexSavedConversationView;
import com.aihub.hub.dto.SaveCodexConversationRequest;
import com.aihub.hub.service.CodexSavedConversationService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/codex/conversations")
public class CodexSavedConversationController {

    private final CodexSavedConversationService service;

    public CodexSavedConversationController(CodexSavedConversationService service) {
        this.service = service;
    }

    @GetMapping
    public List<CodexSavedConversationView> list(@RequestParam(required = false) CodexIntegrationProfile profile) {
        return service.list(profile);
    }

    @GetMapping("/{id}")
    public CodexSavedConversationView find(@PathVariable Long id) {
        return service.find(id);
    }

    @PostMapping
    public CodexSavedConversationView create(@Valid @RequestBody SaveCodexConversationRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    public CodexSavedConversationView update(@PathVariable Long id, @Valid @RequestBody SaveCodexConversationRequest request) {
        return service.update(id, request);
    }
}
