package com.aihub.hub.web;

import com.aihub.hub.dto.GrowthMissionView;
import com.aihub.hub.dto.UpsertGrowthMissionRequest;
import com.aihub.hub.service.GrowthMissionService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/growth/mission")
public class GrowthMissionController {
    private final GrowthMissionService service;

    public GrowthMissionController(GrowthMissionService service) { this.service = service; }

    @GetMapping
    public GrowthMissionView current() { return service.current(); }

    @PutMapping
    public GrowthMissionView save(@Valid @RequestBody UpsertGrowthMissionRequest request) { return service.save(request); }
}
