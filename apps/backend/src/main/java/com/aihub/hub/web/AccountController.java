package com.aihub.hub.web;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    @GetMapping("/read")
    public Map<String, Object> read() {
        return Map.of(
            "connected", false,
            "status", "unsupported"
        );
    }

    @PostMapping("/login/start")
    public Map<String, Object> startLogin(@RequestBody(required = false) Map<String, Object> payload) {
        throw new ResponseStatusException(
            HttpStatus.NOT_IMPLEMENTED,
            "Integração de autenticação ChatGPT não habilitada neste backend"
        );
    }

    @PostMapping("/logout")
    public Map<String, Object> logout() {
        return Map.of(
            "connected", false,
            "status", "disconnected"
        );
    }
}
