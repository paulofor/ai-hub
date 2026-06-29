package com.aihub.hub.web;

import com.aihub.hub.dto.PromptListView;
import com.aihub.hub.service.PromptListService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/prompt-lists")
public class PromptListController {

    private final PromptListService promptListService;

    public PromptListController(PromptListService promptListService) {
        this.promptListService = promptListService;
    }

    @GetMapping
    public List<PromptListView> list() {
        return promptListService.list();
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public PromptListView create(@RequestParam(value = "name", required = false) String name, @RequestParam("file") MultipartFile file) {
        return promptListService.create(name, file);
    }
}
