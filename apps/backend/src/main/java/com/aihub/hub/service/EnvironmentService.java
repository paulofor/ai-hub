package com.aihub.hub.service;

import com.aihub.hub.domain.EnvironmentRecord;
import com.aihub.hub.dto.CreateEnvironmentRequest;
import com.aihub.hub.dto.EnvironmentView;
import com.aihub.hub.repository.EnvironmentRepository;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class EnvironmentService {

    private final EnvironmentRepository environmentRepository;

    public EnvironmentService(EnvironmentRepository environmentRepository) {
        this.environmentRepository = environmentRepository;
    }

    @Transactional(readOnly = true)
    public List<EnvironmentView> listEnvironments() {
        return environmentRepository.findAll(Sort.by(Sort.Direction.ASC, "name")).stream()
            .map(EnvironmentView::from)
            .toList();
    }

    @Transactional
    public EnvironmentView createEnvironment(CreateEnvironmentRequest request) {
        String normalizedName = request.name().trim();
        if (environmentRepository.existsByNameIgnoreCase(normalizedName)) {
            throw new IllegalArgumentException("Já existe um ambiente cadastrado com esse nome.");
        }

        String description = null;
        if (request.description() != null) {
            String trimmedDescription = request.description().trim();
            if (!trimmedDescription.isEmpty()) {
                description = trimmedDescription;
            }
        }

        EnvironmentRecord record = new EnvironmentRecord();
        record.setName(normalizedName);
        record.setDescription(description);

        EnvironmentRecord saved = environmentRepository.save(record);
        return EnvironmentView.from(saved);
    }
}
