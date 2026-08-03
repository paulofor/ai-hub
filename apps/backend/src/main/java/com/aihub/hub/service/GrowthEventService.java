package com.aihub.hub.service;

import com.aihub.hub.domain.GrowthEventRecord;
import com.aihub.hub.domain.GrowthMissionRecord;
import com.aihub.hub.dto.IngestGrowthEventRequest;
import com.aihub.hub.repository.GrowthEventRepository;
import com.aihub.hub.repository.GrowthMissionRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class GrowthEventService {
    public static final Set<String> TYPES = Set.of("VISITOR", "CTA_CLICK", "CHECKOUT_STARTED", "SALE_APPROVED",
        "BRIEFING_COMPLETED", "DELIVERY_COMPLETED", "REFUND", "AD_SPEND");
    private final GrowthMissionRepository missions;
    private final GrowthEventRepository events;

    public GrowthEventService(GrowthMissionRepository missions, GrowthEventRepository events) {
        this.missions = missions;
        this.events = events;
    }

    @Transactional
    public Map<String, Object> ingest(IngestGrowthEventRequest request) {
        String type = request.type().trim().toUpperCase(Locale.ROOT);
        String source = request.source().trim().toLowerCase(Locale.ROOT);
        String eventId = request.eventId().trim();
        if (!TYPES.contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Tipo de evento comercial inválido");

        var duplicate = events.findBySourceAndExternalId(source, eventId);
        if (duplicate.isPresent()) return response(duplicate.get(), true);

        GrowthMissionRecord mission = missions.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE")
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "Não existe missão comercial ativa"));
        if (!mission.getProduct().trim().equalsIgnoreCase(request.product().trim())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "O evento não pertence ao produto da missão ativa");
        }
        GrowthEventRecord event = new GrowthEventRecord();
        event.setMissionId(mission.getId());
        event.setType(type);
        event.setSource(source);
        event.setExternalId(eventId);
        event.setAmount(request.amount() == null ? BigDecimal.ZERO : request.amount());
        event.setOccurredAt(request.occurredAt() == null ? Instant.now() : request.occurredAt());
        try {
            return response(events.saveAndFlush(event), false);
        } catch (DataIntegrityViolationException conflict) {
            return events.findBySourceAndExternalId(source, eventId).map(found -> response(found, true)).orElseThrow(() -> conflict);
        }
    }

    private Map<String, Object> response(GrowthEventRecord event, boolean duplicate) {
        return Map.of("accepted", true, "duplicate", duplicate, "eventId", event.getExternalId(), "type", event.getType());
    }
}
