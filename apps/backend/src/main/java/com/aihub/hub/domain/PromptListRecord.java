package com.aihub.hub.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "prompt_lists")
public class PromptListRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 180)
    private String name;

    @Column(name = "source_filename", nullable = false, length = 255)
    private String sourceFilename;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @OneToMany(mappedBy = "promptList", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("position ASC")
    private List<PromptListItemRecord> items = new ArrayList<>();

    public PromptListRecord() {
    }

    public PromptListRecord(String name, String sourceFilename) {
        this.name = name;
        this.sourceFilename = sourceFilename;
    }

    public void addItem(String prompt, int position) {
        items.add(new PromptListItemRecord(this, prompt, position));
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getSourceFilename() {
        return sourceFilename;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public List<PromptListItemRecord> getItems() {
        return items;
    }
}
