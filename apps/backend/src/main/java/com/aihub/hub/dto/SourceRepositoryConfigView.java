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
    public static final String DEFAULT_OWNER = "paulofor";
    public static final String DEFAULT_REPO = "ai-hub";
    public static final String DEFAULT_BRANCH = "main";

    public static SourceRepositoryConfigView empty() {
        return new SourceRepositoryConfigView(DEFAULT_OWNER, DEFAULT_REPO, DEFAULT_BRANCH, false, null);
    }

    public static SourceRepositoryConfigView from(SourceRepositoryConfig config) {
        return new SourceRepositoryConfigView(
            valueOrDefault(config.getGithubOwner(), DEFAULT_OWNER),
            valueOrDefault(config.getGithubRepo(), DEFAULT_REPO),
            valueOrDefault(config.getGithubBranch(), DEFAULT_BRANCH),
            config.getGithubToken() != null && !config.getGithubToken().isBlank(),
            config.getUpdatedAt()
        );
    }

    private static String valueOrDefault(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
