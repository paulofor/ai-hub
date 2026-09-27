package com.aihub.hub.service;

import com.aihub.hub.domain.CodexModelPricing;
import com.aihub.hub.dto.CodexModelPricingRequest;
import com.aihub.hub.repository.CodexModelPricingRepository;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CodexModelPricingServiceTest {

    private final CodexModelPricingRepository repository = mock(CodexModelPricingRepository.class);
    private final CodexModelPricingService service = new CodexModelPricingService(repository);

    @Test
    void returnsOnlyActiveModelsForRequestSelectors() {
        CodexModelPricing astra = new CodexModelPricing();
        astra.setModelName("gpt-6-astra");
        astra.setActive(true);
        when(repository.findByActiveTrueOrderByModelNameAsc()).thenReturn(List.of(astra));

        assertThat(service.findActive()).containsExactly(astra);
        verify(repository).findByActiveTrueOrderByModelNameAsc();
    }

    @Test
    void persistsActiveFlagFromModelForm() {
        CodexModelPricingRequest request = new CodexModelPricingRequest();
        request.setModelName("gpt-6-sol");
        request.setDisplayName("GPT-6 Sol");
        request.setInputPricePerMillion(BigDecimal.valueOf(2));
        request.setCachedInputPricePerMillion(BigDecimal.valueOf(0.2));
        request.setOutputPricePerMillion(BigDecimal.TEN);
        request.setActive(true);
        when(repository.save(org.mockito.ArgumentMatchers.any(CodexModelPricing.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        CodexModelPricing created = service.create(request);

        assertThat(created.isActive()).isTrue();
    }
}
