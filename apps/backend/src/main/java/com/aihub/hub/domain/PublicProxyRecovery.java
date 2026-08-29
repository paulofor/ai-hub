package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "public_proxy_recoveries")
public class PublicProxyRecovery {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "request_id", nullable = false, unique = true, length = 36)
    private String requestId;

    @Column(nullable = false, length = 500)
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private PublicProxyRecoveryStatus status;

    @Column(name = "github_run_id")
    private Long githubRunId;

    @Column(name = "github_run_url", length = 1000)
    private String githubRunUrl;

    @Column(name = "github_conclusion", length = 40)
    private String githubConclusion;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected PublicProxyRecovery() {
    }

    public PublicProxyRecovery(String requestId, String reason, Instant now) {
        this.requestId = requestId;
        this.reason = reason;
        this.status = PublicProxyRecoveryStatus.REQUESTED;
        this.requestedAt = now;
        this.updatedAt = now;
    }

    public void markDispatched(Instant now) {
        this.status = PublicProxyRecoveryStatus.DISPATCHED;
        this.updatedAt = now;
    }

    public void markDispatchFailed(Instant now) {
        this.status = PublicProxyRecoveryStatus.DISPATCH_FAILED;
        this.updatedAt = now;
    }

    public void updateFromGithub(
        PublicProxyRecoveryStatus newStatus,
        long runId,
        String runUrl,
        String conclusion,
        Instant now
    ) {
        this.status = newStatus;
        this.githubRunId = runId;
        this.githubRunUrl = runUrl;
        this.githubConclusion = conclusion;
        this.updatedAt = now;
    }

    public Long getId() {
        return id;
    }

    public String getRequestId() {
        return requestId;
    }

    public String getReason() {
        return reason;
    }

    public PublicProxyRecoveryStatus getStatus() {
        return status;
    }

    public Long getGithubRunId() {
        return githubRunId;
    }

    public String getGithubRunUrl() {
        return githubRunUrl;
    }

    public String getGithubConclusion() {
        return githubConclusion;
    }

    public Instant getRequestedAt() {
        return requestedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
