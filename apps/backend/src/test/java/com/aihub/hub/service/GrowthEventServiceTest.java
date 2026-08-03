package com.aihub.hub.service;

import com.aihub.hub.domain.GrowthEventRecord;
import com.aihub.hub.domain.GrowthMissionRecord;
import com.aihub.hub.dto.IngestGrowthEventRequest;
import com.aihub.hub.repository.GrowthEventRepository;
import com.aihub.hub.repository.GrowthMissionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GrowthEventServiceTest {
    private GrowthMissionRepository missions;
    private GrowthEventRepository events;
    private GrowthEventService service;

    @BeforeEach
    void setUp() {
        missions = mock(GrowthMissionRepository.class);
        events = mock(GrowthEventRepository.class);
        service = new GrowthEventService(missions, events);
    }

    @Test
    void acceptsEventOnceAndNormalizesProviderValues() {
        GrowthMissionRecord mission = new GrowthMissionRecord();
        mission.setProduct("Agenda Cheia");
        when(events.findBySourceAndExternalId("checkout", "sale-1")).thenReturn(Optional.empty());
        when(missions.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE")).thenReturn(Optional.of(mission));
        when(events.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));

        var result = service.ingest(new IngestGrowthEventRequest("sale_approved", "CHECKOUT", "sale-1",
            "agenda cheia", new BigDecimal("97.00"), null));

        assertThat(result).containsEntry("accepted", true).containsEntry("duplicate", false).containsEntry("type", "SALE_APPROVED");
        verify(events).saveAndFlush(any(GrowthEventRecord.class));
    }

    @Test
    void repeatedProviderEventIsIdempotent() {
        GrowthEventRecord existing = new GrowthEventRecord();
        existing.setSource("checkout");
        existing.setExternalId("sale-1");
        existing.setType("SALE_APPROVED");
        when(events.findBySourceAndExternalId("checkout", "sale-1")).thenReturn(Optional.of(existing));

        var result = service.ingest(new IngestGrowthEventRequest("SALE_APPROVED", "checkout", "sale-1",
            "Agenda Cheia", new BigDecimal("97.00"), null));

        assertThat(result).containsEntry("duplicate", true);
        verify(missions, never()).findFirstByStatusOrderByUpdatedAtDesc(any());
        verify(events, never()).saveAndFlush(any());
    }

    @Test
    void rejectsEventForAnotherProduct() {
        GrowthMissionRecord mission = new GrowthMissionRecord();
        mission.setProduct("Agenda Cheia");
        when(events.findBySourceAndExternalId("checkout", "sale-2")).thenReturn(Optional.empty());
        when(missions.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE")).thenReturn(Optional.of(mission));

        assertThatThrownBy(() -> service.ingest(new IngestGrowthEventRequest("SALE_APPROVED", "checkout", "sale-2",
            "MUSA", new BigDecimal("97.00"), null)))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("não pertence");
    }
}
