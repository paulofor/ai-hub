package com.aihub.hub.domain.video;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "video_render_jobs")
public class VideoRenderJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private VideoProject project;

    @Column(name = "provider", nullable = false, length = 100)
    private String provider;

    @Column(name = "provider_job_id", length = 150)
    private String providerJobId;

    @Column(name = "status", nullable = false, length = 40)
    private String status = "queued";

    @Column(name = "render_profile", length = 150)
    private String renderProfile;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "output_url", length = 500)
    private String outputUrl;

    @Column(name = "failure_reason")
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    private String failureReason;

    public VideoRenderJob() {
    }

    @PrePersist
    public void onCreate() {
        this.requestedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public VideoProject getProject() {
        return project;
    }

    public void setProject(VideoProject project) {
        this.project = project;
    }

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getProviderJobId() {
        return providerJobId;
    }

    public void setProviderJobId(String providerJobId) {
        this.providerJobId = providerJobId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getRenderProfile() {
        return renderProfile;
    }

    public void setRenderProfile(String renderProfile) {
        this.renderProfile = renderProfile;
    }

    public Instant getRequestedAt() {
        return requestedAt;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public String getOutputUrl() {
        return outputUrl;
    }

    public void setOutputUrl(String outputUrl) {
        this.outputUrl = outputUrl;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }
}
