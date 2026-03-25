package com.aihub.hub.dto.video;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class VideoProjectView {

    private final Long id;
    private final String code;
    private final String title;
    private final String description;
    private final String productName;
    private final String status;
    private final String language;
    private final String tone;
    private final String targetAudience;
    private final String primaryGoal;
    private final String callToActionUrl;
    private final String avatarStyle;
    private final String heroImageUrl;
    private final String ownerEmail;
    private final Instant lastSyncedAt;
    private final Instant createdAt;
    private final Instant updatedAt;
    private final List<SceneView> scenes;
    private final List<AssetView> assets;
    private final RenderJobView lastRender;

    public VideoProjectView(Long id,
                            String code,
                            String title,
                            String description,
                            String productName,
                            String status,
                            String language,
                            String tone,
                            String targetAudience,
                            String primaryGoal,
                            String callToActionUrl,
                            String avatarStyle,
                            String heroImageUrl,
                            String ownerEmail,
                            Instant lastSyncedAt,
                            Instant createdAt,
                            Instant updatedAt,
                            List<SceneView> scenes,
                            List<AssetView> assets,
                            RenderJobView lastRender) {
        this.id = id;
        this.code = code;
        this.title = title;
        this.description = description;
        this.productName = productName;
        this.status = status;
        this.language = language;
        this.tone = tone;
        this.targetAudience = targetAudience;
        this.primaryGoal = primaryGoal;
        this.callToActionUrl = callToActionUrl;
        this.avatarStyle = avatarStyle;
        this.heroImageUrl = heroImageUrl;
        this.ownerEmail = ownerEmail;
        this.lastSyncedAt = lastSyncedAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.scenes = scenes != null ? new ArrayList<>(scenes) : new ArrayList<>();
        this.assets = assets != null ? new ArrayList<>(assets) : new ArrayList<>();
        this.lastRender = lastRender;
    }

    public Long getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public String getProductName() {
        return productName;
    }

    public String getStatus() {
        return status;
    }

    public String getLanguage() {
        return language;
    }

    public String getTone() {
        return tone;
    }

    public String getTargetAudience() {
        return targetAudience;
    }

    public String getPrimaryGoal() {
        return primaryGoal;
    }

    public String getCallToActionUrl() {
        return callToActionUrl;
    }

    public String getAvatarStyle() {
        return avatarStyle;
    }

    public String getHeroImageUrl() {
        return heroImageUrl;
    }

    public String getOwnerEmail() {
        return ownerEmail;
    }

    public Instant getLastSyncedAt() {
        return lastSyncedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public List<SceneView> getScenes() {
        return Collections.unmodifiableList(scenes);
    }

    public List<AssetView> getAssets() {
        return Collections.unmodifiableList(assets);
    }

    public RenderJobView getLastRender() {
        return lastRender;
    }

    public static class SceneView {
        private final Long id;
        private final Integer sequenceIndex;
        private final String title;
        private final String script;
        private final String visualStyle;
        private final String voiceoverUrl;
        private final Integer durationSeconds;
        private final String callToActionLabel;
        private final String primaryAssetUrl;
        private final Instant createdAt;
        private final Instant updatedAt;

        public SceneView(Long id,
                         Integer sequenceIndex,
                         String title,
                         String script,
                         String visualStyle,
                         String voiceoverUrl,
                         Integer durationSeconds,
                         String callToActionLabel,
                         String primaryAssetUrl,
                         Instant createdAt,
                         Instant updatedAt) {
            this.id = id;
            this.sequenceIndex = sequenceIndex;
            this.title = title;
            this.script = script;
            this.visualStyle = visualStyle;
            this.voiceoverUrl = voiceoverUrl;
            this.durationSeconds = durationSeconds;
            this.callToActionLabel = callToActionLabel;
            this.primaryAssetUrl = primaryAssetUrl;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }

        public Long getId() {
            return id;
        }

        public Integer getSequenceIndex() {
            return sequenceIndex;
        }

        public String getTitle() {
            return title;
        }

        public String getScript() {
            return script;
        }

        public String getVisualStyle() {
            return visualStyle;
        }

        public String getVoiceoverUrl() {
            return voiceoverUrl;
        }

        public Integer getDurationSeconds() {
            return durationSeconds;
        }

        public String getCallToActionLabel() {
            return callToActionLabel;
        }

        public String getPrimaryAssetUrl() {
            return primaryAssetUrl;
        }

        public Instant getCreatedAt() {
            return createdAt;
        }

        public Instant getUpdatedAt() {
            return updatedAt;
        }
    }

    public static class AssetView {
        private final Long id;
        private final String type;
        private final String label;
        private final String source;
        private final String description;
        private final Instant createdAt;

        public AssetView(Long id,
                         String type,
                         String label,
                         String source,
                         String description,
                         Instant createdAt) {
            this.id = id;
            this.type = type;
            this.label = label;
            this.source = source;
            this.description = description;
            this.createdAt = createdAt;
        }

        public Long getId() {
            return id;
        }

        public String getType() {
            return type;
        }

        public String getLabel() {
            return label;
        }

        public String getSource() {
            return source;
        }

        public String getDescription() {
            return description;
        }

        public Instant getCreatedAt() {
            return createdAt;
        }
    }

    public static class RenderJobView {
        private final Long id;
        private final String provider;
        private final String providerJobId;
        private final String status;
        private final String renderProfile;
        private final Instant requestedAt;
        private final Instant startedAt;
        private final Instant finishedAt;
        private final String outputUrl;
        private final String failureReason;

        public RenderJobView(Long id,
                             String provider,
                             String providerJobId,
                             String status,
                             String renderProfile,
                             Instant requestedAt,
                             Instant startedAt,
                             Instant finishedAt,
                             String outputUrl,
                             String failureReason) {
            this.id = id;
            this.provider = provider;
            this.providerJobId = providerJobId;
            this.status = status;
            this.renderProfile = renderProfile;
            this.requestedAt = requestedAt;
            this.startedAt = startedAt;
            this.finishedAt = finishedAt;
            this.outputUrl = outputUrl;
            this.failureReason = failureReason;
        }

        public Long getId() {
            return id;
        }

        public String getProvider() {
            return provider;
        }

        public String getProviderJobId() {
            return providerJobId;
        }

        public String getStatus() {
            return status;
        }

        public String getRenderProfile() {
            return renderProfile;
        }

        public Instant getRequestedAt() {
            return requestedAt;
        }

        public Instant getStartedAt() {
            return startedAt;
        }

        public Instant getFinishedAt() {
            return finishedAt;
        }

        public String getOutputUrl() {
            return outputUrl;
        }

        public String getFailureReason() {
            return failureReason;
        }
    }
}
