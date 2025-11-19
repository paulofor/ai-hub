package com.aihub.hub.web;

import com.aihub.hub.dto.RepositoryFileView;
import com.aihub.hub.service.RepositoryFileService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/repositories")
public class RepositoryController {

    private final RepositoryFileService repositoryFileService;

    public RepositoryController(RepositoryFileService repositoryFileService) {
        this.repositoryFileService = repositoryFileService;
    }

    @GetMapping("/file")
    public RepositoryFileView fetchFile(@RequestParam String environment,
                                        @RequestParam String path,
                                        @RequestParam(required = false) String ref) {
        return repositoryFileService.fetchFile(environment, path, ref);
    }
}
