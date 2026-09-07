package com.aihub.hub.config;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "hub.public-proxy-recovery")
public record PublicProxyRecoveryProperties(
    boolean enabled,
    @NotBlank String repositoryOwner,
    @NotBlank String repositoryName,
    @NotBlank String workflowFile,
    @NotBlank String ref,
    @NotBlank String targetKey,
    @Min(1) long cooldownSeconds,
    @Min(1) int statusLookupLimit
) {
}
