package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import jakarta.persistence.Convert;

import java.time.Instant;

@Entity
@Table(name = "blueprints")
public class Blueprint {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 150)
    private String name;

    private String description;

    @Lob
    @Column(name = "templates", columnDefinition = "jsonb")
    @Convert(converter = JsonNodeConverter.class)
    private TemplateMap templates = new TemplateMap();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Blueprint() {
    }

    public Blueprint(String name, String description, TemplateMap templates) {
        this.name = name;
        this.description = description;
        this.templates = templates;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public TemplateMap getTemplates() {
        return templates;
    }

    public void setTemplates(TemplateMap templates) {
        this.templates = templates;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
