package com.aihub.hub.service;

import com.aihub.hub.domain.PromptListItemRecord;
import com.aihub.hub.domain.PromptListRecord;
import com.aihub.hub.dto.PromptListItemView;
import com.aihub.hub.dto.PromptListView;
import com.aihub.hub.repository.PromptListRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

@Service
public class PromptListService {

    private final PromptListRepository promptListRepository;

    public PromptListService(PromptListRepository promptListRepository) {
        this.promptListRepository = promptListRepository;
    }

    @Transactional(readOnly = true)
    public List<PromptListView> list() {
        return promptListRepository.findAllWithItemsOrderByCreatedAtDesc().stream().map(this::toView).toList();
    }

    @Transactional
    public PromptListView create(String name, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Envie um arquivo .md com os prompts.");
        }

        String originalFilename = file.getOriginalFilename() == null ? "prompts.md" : file.getOriginalFilename().trim();
        if (!originalFilename.toLowerCase(Locale.ROOT).endsWith(".md")) {
            throw new IllegalArgumentException("O arquivo precisa ter extensão .md.");
        }

        String listName = name == null || name.isBlank() ? originalFilename.replaceFirst("(?i)\\.md$", "") : name.trim();
        List<String> prompts = parseMarkdownPrompts(file);
        if (prompts.isEmpty()) {
            throw new IllegalArgumentException("O arquivo .md precisa conter pelo menos um item iniciado com '*'.");
        }

        PromptListRecord record = promptListRepository.findByNameWithItems(listName)
            .orElseGet(() -> new PromptListRecord(listName, originalFilename));
        record.setSourceFilename(originalFilename);
        record.replaceItems(prompts);

        return toView(promptListRepository.save(record));
    }

    private List<String> parseMarkdownPrompts(MultipartFile file) {
        try {
            String content = new String(file.getBytes(), StandardCharsets.UTF_8);
            return content.lines()
                .map(String::trim)
                .filter((line) -> line.startsWith("*"))
                .map((line) -> line.substring(1).trim())
                .filter((line) -> !line.isBlank())
                .toList();
        } catch (IOException exception) {
            throw new IllegalArgumentException("Não foi possível ler o arquivo enviado.", exception);
        }
    }

    private PromptListView toView(PromptListRecord record) {
        List<PromptListItemView> items = record.getItems().stream()
            .map(this::toItemView)
            .toList();
        return new PromptListView(record.getId(), record.getName(), record.getSourceFilename(), record.getCreatedAt(), items.size(), items);
    }

    private PromptListItemView toItemView(PromptListItemRecord item) {
        return new PromptListItemView(item.getId(), item.getPosition(), item.getPrompt());
    }
}
