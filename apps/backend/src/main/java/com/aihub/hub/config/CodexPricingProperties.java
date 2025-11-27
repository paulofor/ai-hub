package com.aihub.hub.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

@Component
@ConfigurationProperties(prefix = "hub.codex.pricing")
public class CodexPricingProperties {

    private Map<String, ModelPricing> models = new HashMap<>();

    public Map<String, ModelPricing> getModels() {
        return models;
    }

    public void setModels(Map<String, ModelPricing> models) {
        this.models = models;
    }

    public ModelPricing getPricingFor(String model) {
        if (model == null) {
            return null;
        }
        return models.get(model);
    }

    public static class ModelPricing {
        private BigDecimal prompt;
        private BigDecimal completion;

        public BigDecimal getPrompt() {
            return prompt;
        }

        public void setPrompt(BigDecimal prompt) {
            this.prompt = prompt;
        }

        public BigDecimal getCompletion() {
            return completion;
        }

        public void setCompletion(BigDecimal completion) {
            this.completion = completion;
        }
    }
}
