package com.aihub.mcpserver.controller;

import com.aihub.mcpserver.model.CommandRequest;
import com.aihub.mcpserver.model.CommandResponse;
import com.aihub.mcpserver.service.LinuxCommandService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/mcp/tools")
public class LinuxCommandController {

    private final LinuxCommandService linuxCommandService;
    private final String apiToken;

    public LinuxCommandController(LinuxCommandService linuxCommandService,
                                  @Value("${mcp.server.api-token:}") String apiToken) {
        this.linuxCommandService = linuxCommandService;
        this.apiToken = apiToken;
    }

    @PostMapping("/linux-command")
    public ResponseEntity<CommandResponse> execute(@RequestHeader(value = "X-MCP-TOKEN", required = false) String token,
                                                   @Valid @RequestBody CommandRequest request)
            throws Exception {
        if (apiToken == null || apiToken.isBlank() || token == null || !apiToken.equals(token)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid token");
        }

        CommandResponse response = linuxCommandService.execute(request.command());
        return ResponseEntity.ok(response);
    }
}
