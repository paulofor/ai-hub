package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.dto.CodexProductHistory;
import com.aihub.hub.dto.CodexProductRequest;
import com.aihub.hub.repository.CodexProductHistoryRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CodexProductHistoryService {
    public static final int PAGE_SIZE = 15;
    private static final CodexIntegrationProfile PROFILE = CodexIntegrationProfile.CHATGPT_CODEX_MKT;
    private final CodexProductHistoryRepository repository;

    public CodexProductHistoryService(CodexProductHistoryRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Page<CodexProductHistory> products(int page, int size) {
        PageRequest pageable = pageRequest(page, size);
        PageRequest firstRequests = PageRequest.of(0, PAGE_SIZE);
        return repository.findProducts(PROFILE.name(), pageable).map(product -> new CodexProductHistory(
            product.getProductName(), product.getRequestCount(), product.getLatestRequestAt(),
            requestPage(product.getProductName(), firstRequests, product.getRequestCount())
        ));
    }

    @Transactional(readOnly = true)
    public Page<CodexProductRequest> requests(String productName, int page, int size) {
        PageRequest pageable = pageRequest(page, size);
        if (productName == null || productName.isBlank() || productName.length() > 150) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe um produto de até 150 caracteres");
        }
        return requestPage(productName, pageable, repository.countRequests(PROFILE, productName));
    }

    private Page<CodexProductRequest> requestPage(String productName, PageRequest pageable, long count) {
        return new PageImpl<>(count == 0 ? java.util.List.of() : repository.findRequests(PROFILE, productName, pageable),
            pageable, count);
    }

    private PageRequest pageRequest(int page, int size) {
        if (page < 0 || size != PAGE_SIZE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe página não negativa e 15 itens por página");
        }
        return PageRequest.of(page, size);
    }
}
