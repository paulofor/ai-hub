package com.aihub.hub.service;

public record SandboxJobRequest(
    String jobId,
    String repoUrl,
    String branch,
    String task,
    String slug,
    String language,
    String testCommand
) {
}
