package com.aihub.hub.service;

import com.aihub.hub.config.CodexPricingProperties;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;

@Component
public class TokenCostCalculator {

    private static final BigDecimal THOUSAND = BigDecimal.valueOf(1000);
    private final CodexPricingProperties pricingProperties;

    public TokenCostCalculator(CodexPricingProperties pricingProperties) {
        this.pricingProperties = pricingProperties;
    }

    public BigDecimal calculate(String model, Integer promptTokens, Integer completionTokens, Integer totalTokens) {
        CodexPricingProperties.ModelPricing pricing = pricingProperties.getPricingFor(model);
        if (pricing == null) {
            return null;
        }

        int promptCount = Optional.ofNullable(promptTokens).orElse(0);
        int completionCount = Optional.ofNullable(completionTokens).orElse(0);

        if (promptTokens == null && completionTokens == null && totalTokens != null) {
            completionCount = totalTokens;
        } else if (totalTokens != null && completionTokens == null) {
            completionCount = Math.max(totalTokens - promptCount, 0);
        }

        BigDecimal promptCost = costForTokens(pricing.getPrompt(), promptCount);
        BigDecimal completionCost = costForTokens(pricing.getCompletion(), completionCount);

        return promptCost.add(completionCost);
    }

    private BigDecimal costForTokens(BigDecimal costPerThousandTokens, int tokens) {
        if (costPerThousandTokens == null || tokens <= 0) {
            return BigDecimal.ZERO;
        }
        return costPerThousandTokens
            .multiply(BigDecimal.valueOf(tokens))
            .divide(THOUSAND, 6, RoundingMode.HALF_UP);
    }
}
