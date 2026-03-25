package com.aihub.hub.dto.video;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.ArrayList;
import java.util.List;

public class CreateVideoProjectRequest {

    @NotBlank
    @Pattern(regexp = "^[a-zA-Z0-9_-]{3,50}$", message = "Código deve conter entre 3 e 50 caracteres alfanuméricos")
    private String code;

    @NotBlank
    @Size(max = 255)
    private String title;

    @Size(max = 1000)
    private String description;

    @Size(max = 255)
    private String productName;

    @Size(max = 40)
    private String status;

    @Size(max = 10)
    private String language;

    @Size(max = 80)
    private String tone;

    @Size(max = 255)
    private String targetAudience;

    @Size(max = 255)
    private String primaryGoal;

    @Size(max = 500)
    private String callToActionUrl;

    @Size(max = 100)
    private String avatarStyle;

    @Size(max = 500)
    private String heroImageUrl;

    @Valid
    private List<SceneInput> scenes = new ArrayList<>();

    @Valid
    private List<AssetInput> assets = new ArrayList<>();

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getProductName() {
        return productName;
    }

    public void setProductName(String productName) {
        this.productName = productName;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }

    public String getTone() {
        return tone;
    }

    public void setTone(String tone) {
        this.tone = tone;
    }

    public String getTargetAudience() {
        return targetAudience;
    }

    public void setTargetAudience(String targetAudience) {
        this.targetAudience = targetAudience;
    }

    public String getPrimaryGoal() {
        return primaryGoal;
    }

    public void setPrimaryGoal(String primaryGoal) {
        this.primaryGoal = primaryGoal;
    }

    public String getCallToActionUrl() {
        return callToActionUrl;
    }

    public void setCallToActionUrl(String callToActionUrl) {
        this.callToActionUrl = callToActionUrl;
    }

    public String getAvatarStyle() {
        return avatarStyle;
    }

    public void setAvatarStyle(String avatarStyle) {
        this.avatarStyle = avatarStyle;
    }

    public String getHeroImageUrl() {
        return heroImageUrl;
    }

    public void setHeroImageUrl(String heroImageUrl) {
        this.heroImageUrl = heroImageUrl;
    }

    public List<SceneInput> getScenes() {
        return scenes;
    }

    public void setScenes(List<SceneInput> scenes) {
        this.scenes = scenes != null ? scenes : new ArrayList<>();
    }

    public List<AssetInput> getAssets() {
        return assets;
    }

    public void setAssets(List<AssetInput> assets) {
        this.assets = assets != null ? assets : new ArrayList<>();
    }

    public static class SceneInput {

        @NotNull
        @PositiveOrZero
        private Integer sequenceIndex;

        @Size(max = 255)
        private String title;

        @NotBlank
        private String script;

        @Size(max = 100)
        private String visualStyle;

        @Size(max = 500)
        private String voiceoverUrl;

        @PositiveOrZero
        private Integer durationSeconds;

        @Size(max = 100)
        private String callToActionLabel;

        @Size(max = 500)
        private String primaryAssetUrl;

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
    }

    public static class AssetInput {

        @NotBlank
        @Size(max = 50)
        private String type;

        @NotBlank
        @Size(max = 150)
        private String label;

        @NotBlank
        @Size(max = 500)
        private String source;

        @Size(max = 500)
        private String description;

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getLabel() {
            return label;
        }

        public void setLabel(String label) {
            this.label = label;
        }

        public String getSource() {
            return source;
        }

        public void setSource(String source) {
            this.source = source;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }
    }
}
