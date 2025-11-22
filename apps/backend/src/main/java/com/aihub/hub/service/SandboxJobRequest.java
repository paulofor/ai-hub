package com.aihub.hub.service;

public record SandboxJobRequest(
    String jobId,
    String repoSlug,
    String repoUrl,
    String branch,
    String taskDescription,
    String commitHash,
    String testCommand
) {
}
