package com.aihub.hub.service;

import com.aihub.hub.domain.CodexModelPricing;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TokenCostCalculatorTest {

    private final CodexModelPricingService pricingService = mock(CodexModelPricingService.class);
    private final TokenCostCalculator calculator = new TokenCostCalculator(pricingService);

    @Test
    void calculatesCachedInputAsPartOfTotalInput() {
        when(pricingService.findByModelName("gpt-5.5")).thenReturn(Optional.of(pricing("gpt-5.5")));

        TokenCostBreakdown breakdown = calculator.calculate(
            "gpt-5.5",
            100_000,
            80_000,
            10_000,
            110_000
        );

        assertThat(breakdown.inputTokens()).isEqualTo(100_000);
        assertThat(breakdown.cachedInputTokens()).isEqualTo(80_000);
        assertThat(breakdown.outputTokens()).isEqualTo(10_000);
        assertThat(breakdown.totalTokens()).isEqualTo(110_000);
        assertThat(breakdown.inputCost()).isEqualByComparingTo("0.100000");
        assertThat(breakdown.cachedInputCost()).isEqualByComparingTo("0.040000");
        assertThat(breakdown.outputCost()).isEqualByComparingTo("0.300000");
        assertThat(breakdown.totalCost()).isEqualByComparingTo("0.440000");
    }

    @Test
    void appliesGpt55LongContextPricingAboveInputThreshold() {
        when(pricingService.findByModelName("gpt-5.5")).thenReturn(Optional.of(pricing("gpt-5.5")));

        TokenCostBreakdown breakdown = calculator.calculate(
            "gpt-5.5",
            2_036_035,
            1_916_288,
            10_508,
            2_046_543
        );

        assertThat(breakdown.inputCost()).isEqualByComparingTo("1.197470");
        assertThat(breakdown.cachedInputCost()).isEqualByComparingTo("1.916288");
        assertThat(breakdown.outputCost()).isEqualByComparingTo("0.472860");
        assertThat(breakdown.totalCost()).isEqualByComparingTo("3.586618");
    }

    private CodexModelPricing pricing(String modelName) {
        CodexModelPricing pricing = new CodexModelPricing();
        pricing.setModelName(modelName);
        pricing.setInputPricePerMillion(BigDecimal.valueOf(5));
        pricing.setCachedInputPricePerMillion(BigDecimal.valueOf(0.5));
        pricing.setOutputPricePerMillion(BigDecimal.valueOf(30));
        return pricing;
    }
}
