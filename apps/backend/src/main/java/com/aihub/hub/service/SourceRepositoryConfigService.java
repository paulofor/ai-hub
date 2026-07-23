package com.aihub.hub.service;

import com.aihub.hub.domain.SourceRepositoryConfig;
import com.aihub.hub.dto.SourceRepositoryConfigRequest;
import com.aihub.hub.dto.SourceRepositoryConfigView;
import com.aihub.hub.repository.SourceRepositoryConfigRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Optional;

import static com.aihub.hub.dto.SourceRepositoryConfigView.DEFAULT_BRANCH;
import static com.aihub.hub.dto.SourceRepositoryConfigView.DEFAULT_OWNER;
import static com.aihub.hub.dto.SourceRepositoryConfigView.DEFAULT_REPO;

@Service
public class SourceRepositoryConfigService {

    private static final long SINGLETON_ID = 1L;

    private final SourceRepositoryConfigRepository repository;
    private final Clock clock;

    public SourceRepositoryConfigService(SourceRepositoryConfigRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public SourceRepositoryConfigView getConfigView() {
        return repository.findById(SINGLETON_ID)
            .map(SourceRepositoryConfigView::from)
            .orElseGet(SourceRepositoryConfigView::empty);
    }

    @Transactional(readOnly = true)
    public Optional<SourceRepositoryConfig> getConfig() {
        return repository.findById(SINGLETON_ID);
    }

    @Transactional
    public SourceRepositoryConfigView saveConfig(SourceRepositoryConfigRequest request) {
        SourceRepositoryConfig config = repository.findById(SINGLETON_ID).orElseGet(() -> {
            SourceRepositoryConfig created = new SourceRepositoryConfig();
            created.setId(SINGLETON_ID);
            return created;
        });

        String normalizedToken = normalizeNullable(request.token());

        if (normalizedToken == null && (config.getGithubToken() == null || config.getGithubToken().isBlank())) {
            throw new IllegalArgumentException("Cole o token do GitHub para salvar a configuração.");
        }

        config.setGithubOwner(DEFAULT_OWNER);
        config.setGithubRepo(DEFAULT_REPO);
        config.setGithubBranch(DEFAULT_BRANCH);
        if (normalizedToken != null) {
            config.setGithubToken(normalizedToken);
        }
        config.setUpdatedAt(clock.instant());

        return SourceRepositoryConfigView.from(repository.save(config));
    }

    private static String normalizeNullable(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
