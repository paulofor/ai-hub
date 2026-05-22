package com.aihub.mcpserver.controller;

import com.aihub.mcpserver.model.CommandRequest;
import com.aihub.mcpserver.model.CommandResponse;
import com.aihub.mcpserver.service.LinuxCommandService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/mcp/tools")
public class LinuxCommandController {

    private final LinuxCommandService linuxCommandService;

    public LinuxCommandController(LinuxCommandService linuxCommandService) {
        this.linuxCommandService = linuxCommandService;
    }

    @PostMapping("/linux-command")
    public ResponseEntity<CommandResponse> execute(@Valid @RequestBody CommandRequest request)
            throws Exception {
        CommandResponse response = linuxCommandService.execute(request.command());
        return ResponseEntity.ok(response);
    }
}
