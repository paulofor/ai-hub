package com.aihub.hub.web;

import com.aihub.hub.dto.SourceModuleChangeView;
import com.aihub.hub.service.SourceModuleChangeService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/source-modules")
public class SourceModuleChangeController {

    private final SourceModuleChangeService sourceModuleChangeService;

    public SourceModuleChangeController(SourceModuleChangeService sourceModuleChangeService) {
        this.sourceModuleChangeService = sourceModuleChangeService;
    }

    @GetMapping("/changes")
    public List<SourceModuleChangeView> listModuleChanges() {
        return sourceModuleChangeService.listModuleChanges();
    }
}
