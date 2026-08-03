package com.aihub.hub.web;

import com.aihub.hub.dto.IngestGrowthEventRequest;
import com.aihub.hub.service.GrowthEventService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

@RestController
@RequestMapping("/api/growth/events")
public class GrowthEventController {
    private final GrowthEventService service;
    private final String token;

    public GrowthEventController(GrowthEventService service, @Value("${hub.growth.events-token:}") String token) {
        this.service = service;
        this.token = token == null ? "" : token.trim();
    }

    @PostMapping
    public Map<String, Object> ingest(@Valid @RequestBody IngestGrowthEventRequest request,
                                      @RequestHeader(value = "X-Growth-Events-Token", required = false) String supplied) {
        if (token.isBlank()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Ingestão comercial não configurada");
        if (!MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), (supplied == null ? "" : supplied).getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Token de eventos comerciais inválido");
        }
        return service.ingest(request);
    }
}
