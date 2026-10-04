package com.aihub.hub.web;

import com.aihub.hub.dto.CodexProductHistory;
import com.aihub.hub.dto.CodexProductRequest;
import com.aihub.hub.service.CodexProductHistoryService;
import org.springframework.data.domain.Page;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/codex/requests/marketing-products")
public class CodexProductHistoryController {
    private final CodexProductHistoryService service;

    public CodexProductHistoryController(CodexProductHistoryService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<Page<CodexProductHistory>> products(@RequestParam(defaultValue = "0") int page,
                                                             @RequestParam(defaultValue = "15") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.products(page, size));
    }

    @GetMapping("/requests")
    public ResponseEntity<Page<CodexProductRequest>> requests(@RequestParam String productName,
                                                            @RequestParam(defaultValue = "0") int page,
                                                            @RequestParam(defaultValue = "15") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.requests(productName, page, size));
    }
}
