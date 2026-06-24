package com.aihub.hub.service;

import java.util.List;

public record SandboxJobRequest(
    String jobId,
    String repoSlug,
    String repoUrl,
    String branch,
    String taskDescription,
    String commitHash,
    String testCommand,
    String profile,
    String model,
    String accessToken,
    String githubToken,
    DatabaseConnection database,
    String callbackUrl,
    String callbackSecret,
    List<ImageAttachment> imageAttachments
) {
    public record ImageAttachment(
        String name,
        String mimeType,
        Long size,
        String dataUrl
    ) { }
    public record DatabaseConnection(
        String host,
        Integer port,
        String database,
        String user,
        String password
    ) { }
}
