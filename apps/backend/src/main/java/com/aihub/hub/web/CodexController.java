package com.aihub.hub.web;

import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.dto.CreateCodexRequest;
import com.aihub.hub.dto.RateCodexRequest;
import com.aihub.hub.dto.SaveCodexCommentRequest;
import com.aihub.hub.service.CodexRequestService;
import com.aihub.hub.service.PullRequestService;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/codex/requests")
public class CodexController {

    private final CodexRequestService codexRequestService;
    private final PullRequestService pullRequestService;

    public CodexController(CodexRequestService codexRequestService, PullRequestService pullRequestService) {
        this.codexRequestService = codexRequestService;
        this.pullRequestService = pullRequestService;
    }

    @GetMapping
    public Object list(@RequestParam(required = false) Integer page,
                       @RequestParam(required = false) Integer size) {
        if (page == null && size == null) {
            return codexRequestService.list();
        }
        int resolvedPage = page != null ? page : 0;
        int resolvedSize = size != null ? size : 5;
        Page<CodexRequest> result = codexRequestService.listPage(resolvedPage, resolvedSize);
        return result;
    }

    @GetMapping("/{id}")
    public CodexRequest get(@PathVariable Long id) {
        return codexRequestService.find(id);
    }

    @PostMapping
    public CodexRequest create(@Valid @RequestBody CreateCodexRequest request) {
        return codexRequestService.create(request);
    }

    @PostMapping("/{id}/comment")
    public CodexRequest comment(@PathVariable Long id, @Valid @RequestBody SaveCodexCommentRequest request) {
        return codexRequestService.saveComment(id, request);
    }

    @PostMapping("/{id}/cancel")
    public CodexRequest cancel(@PathVariable Long id) {
        return codexRequestService.cancel(id);
    }

    @PostMapping("/{id}/create-pr")
    public Map<String, Object> createPr(@PathVariable Long id,
                                        @RequestHeader(value = "X-Role", defaultValue = "viewer") String role,
                                        @RequestHeader(value = "X-User", defaultValue = "unknown") String actor) {
        assertOwner(role);
        CodexRequest request = codexRequestService.find(id);
        RepoCoordinates coordinates = RepoCoordinates.from(request.getEnvironment());
        if (coordinates == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ambiente da solicitação não está no formato owner/repo");
        }

        ResponseRecord response = codexRequestService.findLatestResponseForEnvironment(request.getEnvironment())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nenhuma resposta encontrada na tabela responses para esta solicitação"));

        String diff = Optional.ofNullable(response.getUnifiedDiff())
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Resposta encontrada não possui patch/unifiedDiff"));

        String title = "AI Hub: Correção da solicitação #" + request.getId();
        JsonNode pr = pullRequestService.createFixPr(
            actor,
            coordinates.owner(),
            coordinates.repo(),
            "main",
            title,
            diff,
            Optional.ofNullable(response.getFixPlan()).orElse("PR criado a partir da resposta registrada na tabela responses.")
        );

        String htmlUrl = pr != null && pr.hasNonNull("html_url") ? pr.get("html_url").asText() : null;
        Integer number = pr != null && pr.hasNonNull("number") ? pr.get("number").asInt() : null;
        Map<String, Object> payload = new HashMap<>();
        payload.put("number", number);
        payload.put("url", htmlUrl);
        payload.put("title", title);
        payload.put("createdAt", Instant.now().toString());
        return payload;
    }

    private void assertOwner(String role) {
        if (!"owner".equalsIgnoreCase(role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Ação requer confirmação de um owner");
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

    @PostMapping("/{id}/rating")
    public CodexRequest rate(@PathVariable Long id, @Valid @RequestBody RateCodexRequest request) {
        return codexRequestService.rate(id, request);
    }
}
