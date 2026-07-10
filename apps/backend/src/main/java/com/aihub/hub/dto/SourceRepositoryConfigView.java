package com.aihub.hub.dto;

import com.aihub.hub.domain.SourceRepositoryConfig;

import java.time.Instant;

public record SourceRepositoryConfigView(
    String owner,
    String repo,
    String branch,
    boolean tokenConfigured,
    Instant updatedAt
) {
    public static SourceRepositoryConfigView empty() {
        return new SourceRepositoryConfigView("", "", "main", false, null);
    }

    public static SourceRepositoryConfigView from(SourceRepositoryConfig config) {
        return new SourceRepositoryConfigView(
            config.getGithubOwner(),
            config.getGithubRepo(),
            config.getGithubBranch(),
            config.getGithubToken() != null && !config.getGithubToken().isBlank(),
            config.getUpdatedAt()
        );
    }
}
