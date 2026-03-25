package com.aihub.hub.web;

import com.aihub.hub.dto.video.CreateVideoProjectRequest;
import com.aihub.hub.dto.video.VideoProjectView;
import com.aihub.hub.service.VideoProjectService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/video/projects")
public class VideoProjectController {

    private final VideoProjectService videoProjectService;

    public VideoProjectController(VideoProjectService videoProjectService) {
        this.videoProjectService = videoProjectService;
    }

    @GetMapping
    public List<VideoProjectView> list() {
        return videoProjectService.listProjects();
    }

    @GetMapping("/{id}")
    public ResponseEntity<VideoProjectView> get(@PathVariable Long id) {
        return videoProjectService.getProject(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<VideoProjectView> create(@RequestHeader(value = "X-Role", defaultValue = "viewer") String role,
                                                   @RequestHeader(value = "X-User", defaultValue = "unknown") String actor,
                                                   @Valid @RequestBody CreateVideoProjectRequest request) {
        assertOwner(role);
        VideoProjectView view = videoProjectService.createProject(actor, request);
        return ResponseEntity.ok(view);
    }

    private void assertOwner(String role) {
        if (!"owner".equalsIgnoreCase(role)) {
            throw new IllegalStateException("Ação requer confirmação de um owner");
        }
    }
}
