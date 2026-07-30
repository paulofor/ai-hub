package com.aihub.hub.web;

import com.aihub.hub.service.SystemMaintenanceService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/system-health")
public class SystemMaintenanceController {
    private final SystemMaintenanceService service;
    private final String adminToken;

    public SystemMaintenanceController(SystemMaintenanceService service,
                                       @Value("${hub.maintenance.admin-token:}") String adminToken) {
        this.service = service;
        this.adminToken = adminToken == null ? "" : adminToken.trim();
    }

    @GetMapping
    public Map<String, Object> status(@RequestHeader(value = "X-Admin-Token", required = false) String token) {
        authorize(token);
        return service.status();
    }

    @PostMapping("/actions/{action}")
    public Map<String, Object> action(@PathVariable String action,
                                     @RequestBody(required = false) Map<String, Object> body,
                                     @RequestHeader(value = "X-Admin-Token", required = false) String token,
                                     @RequestHeader(value = "X-Idempotency-Key", required = false) String idempotencyKey,
                                     @RequestHeader(value = "X-User", defaultValue = "admin") String actor) {
        authorize(token);
        String jobId = body == null ? null : String.valueOf(body.getOrDefault("jobId", ""));
        try {
            return service.run(action, jobId, actor, idempotencyKey);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        } catch (IllegalStateException ex) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, ex.getMessage());
        }
    }

    private void authorize(String supplied) {
        if (adminToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Painel de manutenção não configurado");
        }
        byte[] expected = adminToken.getBytes(StandardCharsets.UTF_8);
        byte[] actual = (supplied == null ? "" : supplied).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Acesso exclusivo para administradores");
        }
    }
}
