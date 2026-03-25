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
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import java.time.Instant;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "video_scenes")
public class VideoScene {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private VideoProject project;

    @Column(name = "sequence_index", nullable = false)
    private Integer sequenceIndex;

    @Column(length = 255)
    private String title;

    @Column(name = "script", nullable = false)
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    private String script;

    @Column(name = "visual_style", length = 100)
    private String visualStyle;

    @Column(name = "voiceover_url", length = 500)
    private String voiceoverUrl;

    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    @Column(name = "call_to_action_label", length = 100)
    private String callToActionLabel;

    @Column(name = "primary_asset_url", length = 500)
    private String primaryAssetUrl;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    public VideoScene() {
    }

    @PrePersist
    public void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    public void onUpdate() {
        this.updatedAt = Instant.now();
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

    public Integer getSequenceIndex() {
        return sequenceIndex;
    }

    public void setSequenceIndex(Integer sequenceIndex) {
        this.sequenceIndex = sequenceIndex;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getScript() {
        return script;
    }

    public void setScript(String script) {
        this.script = script;
    }

    public String getVisualStyle() {
        return visualStyle;
    }

    public void setVisualStyle(String visualStyle) {
        this.visualStyle = visualStyle;
    }

    public String getVoiceoverUrl() {
        return voiceoverUrl;
    }

    public void setVoiceoverUrl(String voiceoverUrl) {
        this.voiceoverUrl = voiceoverUrl;
    }

    public Integer getDurationSeconds() {
        return durationSeconds;
    }

    public void setDurationSeconds(Integer durationSeconds) {
        this.durationSeconds = durationSeconds;
    }

    public String getCallToActionLabel() {
        return callToActionLabel;
    }

    public void setCallToActionLabel(String callToActionLabel) {
        this.callToActionLabel = callToActionLabel;
    }

    public String getPrimaryAssetUrl() {
        return primaryAssetUrl;
    }

    public void setPrimaryAssetUrl(String primaryAssetUrl) {
        this.primaryAssetUrl = primaryAssetUrl;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
