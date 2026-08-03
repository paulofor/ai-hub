package com.aihub.hub.service;

import com.aihub.hub.domain.GrowthMissionRecord;
import com.aihub.hub.dto.GrowthMissionView;
import com.aihub.hub.dto.UpsertGrowthMissionRequest;
import com.aihub.hub.repository.GrowthMissionRepository;
import com.aihub.hub.repository.GrowthEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GrowthMissionServiceTest {
    private GrowthMissionRepository repository;
    private GrowthMissionService service;

    @BeforeEach
    void setUp() {
        repository = mock(GrowthMissionRepository.class);
        GrowthEventRepository events = mock(GrowthEventRepository.class);
        service = new GrowthMissionService(repository, events);
        when(repository.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void prioritizesOfferWhenVisitorsDoNotClick() {
        GrowthMissionView result = service.save(request(1000, 10, 2, 0, 0, 0, "50", "50"));

        assertThat(result.bottleneck()).isEqualTo("OFERTA");
        assertThat(result.conversionRate()).isEqualByComparingTo("0.00");
    }

    @Test
    void stopsAcquisitionWhenDeliveryIsBehindSales() {
        GrowthMissionView result = service.save(request(1000, 100, 20, 5, 5, 2, "1000", "200"));

        assertThat(result.bottleneck()).isEqualTo("ENTREGA");
        assertThat(result.cac()).isEqualByComparingTo("40.00");
    }

    @Test
    void respectsBudgetFuseBeforeSuggestingMoreTraffic() {
        GrowthMissionView result = service.save(request(1000, 100, 20, 0, 0, 0, "0", "400"));

        assertThat(result.bottleneck()).isEqualTo("ORCAMENTO_ESGOTADO");
    }

    private UpsertGrowthMissionRequest request(long visitors, long clicks, long checkouts, long sales,
                                               long briefings, long deliveries, String revenue, String spend) {
        return new UpsertGrowthMissionRequest("Agenda Cheia", "Gerar dez vendas", 10, new BigDecimal("400"), null,
            "ACTIVE", visitors, clicks, checkouts, sales, briefings, deliveries, 0L,
            new BigDecimal(revenue), new BigDecimal(spend));
    }
}
