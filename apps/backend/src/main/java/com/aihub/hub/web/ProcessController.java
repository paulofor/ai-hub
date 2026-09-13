package com.aihub.hub.web;

import com.aihub.hub.dto.ProcessRequest;
import com.aihub.hub.dto.ProcessView;
import com.aihub.hub.service.ProcessService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/api/processes")
public class ProcessController {
    private final ProcessService service;
    public ProcessController(ProcessService service) { this.service = service; }
    @GetMapping public List<ProcessView> list() { return service.list(); }
    @PostMapping @ResponseStatus(HttpStatus.CREATED) public ProcessView create(@Valid @RequestBody ProcessRequest request) { return service.create(request); }
    @PutMapping("/{id}") public ProcessView update(@PathVariable Long id, @Valid @RequestBody ProcessRequest request) { return service.update(id, request); }
    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void delete(@PathVariable Long id) { service.delete(id); }
}
