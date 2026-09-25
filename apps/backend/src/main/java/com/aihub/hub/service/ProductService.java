package com.aihub.hub.service;

import com.aihub.hub.domain.ProductRecord;
import com.aihub.hub.dto.CreateProductRequest;
import com.aihub.hub.dto.ProductView;
import com.aihub.hub.dto.UpdateProductRequest;
import com.aihub.hub.repository.ProductRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class ProductService {

    private final ProductRepository productRepository;

    public ProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Transactional(readOnly = true)
    public List<ProductView> list() {
        return productRepository.findAllByOrderByNameAsc().stream().map(this::toView).toList();
    }

    @Transactional
    public ProductView create(CreateProductRequest request) {
        String name = request.name().trim();

        ProductRecord record = new ProductRecord();
        record.setName(name);
        applyExecutionDefaults(record, request.modelName(), request.reasoningEffort());

        return toView(productRepository.save(record));
    }

    @Transactional
    public ProductView update(Long id, UpdateProductRequest request) {
        ProductRecord record = productRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Produto não encontrado"));

        String name = request.name().trim();

        record.setName(name);
        applyExecutionDefaults(record, request.modelName(), request.reasoningEffort());
        record.touchUpdatedAt();

        return toView(productRepository.save(record));
    }

    @Transactional
    public void delete(Long id) {
        if (!productRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Produto não encontrado");
        }
        productRepository.deleteById(id);
    }

    private ProductView toView(ProductRecord record) {
        return new ProductView(
            record.getId(),
            record.getName(),
            record.getModelName(),
            record.getReasoningEffort(),
            record.getCreatedAt(),
            record.getUpdatedAt()
        );
    }

    private void applyExecutionDefaults(ProductRecord record, String modelName, String reasoningEffort) {
        record.setModelName(normalizeOptional(modelName));
        String normalizedReasoning = normalizeOptional(reasoningEffort);
        record.setReasoningEffort(normalizedReasoning == null ? null : normalizedReasoning.toLowerCase());
    }

    private String normalizeOptional(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
