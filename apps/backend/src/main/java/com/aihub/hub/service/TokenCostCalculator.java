package com.aihub.hub.service;

import com.aihub.hub.domain.CodexModelPricing;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;

@Component
public class TokenCostCalculator {

    private static final BigDecimal MILLION = BigDecimal.valueOf(1_000_000L);
    private static final int GPT_5_5_LONG_CONTEXT_INPUT_THRESHOLD = 272_000;
    private static final BigDecimal GPT_5_5_LONG_CONTEXT_INPUT_MULTIPLIER = BigDecimal.valueOf(2);
    private static final BigDecimal GPT_5_5_LONG_CONTEXT_OUTPUT_MULTIPLIER = BigDecimal.valueOf(1.5);

    private final CodexModelPricingService pricingService;

    public TokenCostCalculator(CodexModelPricingService pricingService) {
        this.pricingService = pricingService;
    }

    public TokenCostBreakdown calculate(
        String model,
        Integer inputTokens,
        Integer cachedInputTokens,
        Integer outputTokens,
        Integer totalTokens
    ) {
        Optional<CodexModelPricing> pricingOptional = pricingService.findByModelName(model);
        if (pricingOptional.isEmpty()) {
            return null;
        }

        CodexModelPricing pricing = pricingOptional.get();

        int inputCount = Optional.ofNullable(inputTokens).orElse(0);
        int cachedInputCount = Optional.ofNullable(cachedInputTokens).orElse(0);
        int outputCount = Optional.ofNullable(outputTokens).orElse(0);

        Integer resolvedTotal = totalTokens;
        if (inputTokens == null && resolvedTotal != null && outputTokens != null) {
            inputCount = Math.max(resolvedTotal - outputCount, 0);
        }
        if (inputCount == 0 && cachedInputCount > 0) {
            inputCount = cachedInputCount;
        }

        if (resolvedTotal == null) {
            resolvedTotal = inputCount + outputCount;
        } else {
            int known = inputCount + outputCount;
            if (known == 0) {
                outputCount = resolvedTotal;
            } else if (known < resolvedTotal) {
                if (outputCount == 0) {
                    outputCount = Math.max(resolvedTotal - inputCount, 0);
                } else if (inputTokens == null) {
                    inputCount = Math.max(resolvedTotal - outputCount, 0);
                }
            }
        }

        int billableCachedInputCount = Math.min(cachedInputCount, inputCount);
        int billableInputCount = Math.max(inputCount - billableCachedInputCount, 0);

        BigDecimal inputPrice = pricing.getInputPricePerMillion();
        BigDecimal cachedInputPrice = pricing.getCachedInputPricePerMillion();
        BigDecimal outputPrice = pricing.getOutputPricePerMillion();
        if (usesGpt55LongContext(model, inputCount)) {
            inputPrice = multiply(inputPrice, GPT_5_5_LONG_CONTEXT_INPUT_MULTIPLIER);
            cachedInputPrice = multiply(cachedInputPrice, GPT_5_5_LONG_CONTEXT_INPUT_MULTIPLIER);
            outputPrice = multiply(outputPrice, GPT_5_5_LONG_CONTEXT_OUTPUT_MULTIPLIER);
        }

        BigDecimal inputCost = costForTokens(inputPrice, billableInputCount);
        BigDecimal cachedInputCost = costForTokens(cachedInputPrice, billableCachedInputCount);
        BigDecimal outputCost = costForTokens(outputPrice, outputCount);
        BigDecimal totalCost = inputCost.add(cachedInputCost).add(outputCost);

        return new TokenCostBreakdown(
            inputCount,
            cachedInputCount,
            outputCount,
            resolvedTotal,
            inputCost,
            cachedInputCost,
            outputCost,
            totalCost
        );
    }

    private boolean usesGpt55LongContext(String model, int inputTokens) {
        return "gpt-5.5".equalsIgnoreCase(Optional.ofNullable(model).orElse("").trim())
            && inputTokens > GPT_5_5_LONG_CONTEXT_INPUT_THRESHOLD;
    }

    private BigDecimal multiply(BigDecimal value, BigDecimal multiplier) {
        if (value == null) {
            return null;
        }
        return value.multiply(multiplier);
    }

    private BigDecimal costForTokens(BigDecimal pricePerMillion, int tokens) {
        if (pricePerMillion == null || tokens <= 0) {
            return BigDecimal.ZERO.setScale(6, RoundingMode.HALF_UP);
        }
        return pricePerMillion
            .multiply(BigDecimal.valueOf(tokens))
            .divide(MILLION, 6, RoundingMode.HALF_UP);
    }
}
