package com.aihub.hub.web;

import com.aihub.hub.dto.SourceRepositoryConfigRequest;
import com.aihub.hub.dto.SourceRepositoryConfigView;
import com.aihub.hub.service.SourceRepositoryConfigService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/source-repository-config")
public class SourceRepositoryConfigController {

    private final SourceRepositoryConfigService service;

    public SourceRepositoryConfigController(SourceRepositoryConfigService service) {
        this.service = service;
    }

    @GetMapping
    public SourceRepositoryConfigView getConfig() {
        return service.getConfigView();
    }

    @PutMapping
    public SourceRepositoryConfigView saveConfig(@Valid @RequestBody SourceRepositoryConfigRequest request) {
        return service.saveConfig(request);
    }
}
