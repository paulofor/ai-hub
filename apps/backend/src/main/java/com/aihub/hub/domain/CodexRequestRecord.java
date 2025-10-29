package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "codex_requests")
public class CodexRequestRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 150)
    private String environment;

    @Column(nullable = false, length = 150)
    private String model;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String prompt;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "response_text", columnDefinition = "LONGTEXT")
    private String responseText;

    @Column(name = "external_id", length = 120)
    private String externalId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public CodexRequestRecord() {
    }

    public CodexRequestRecord(String environment, String model, String prompt) {
        this.environment = environment;
        this.model = model;
        this.prompt = prompt;
    }

    public Long getId() {
        return id;
    }

    public String getEnvironment() {
        return environment;
    }

    public String getModel() {
        return model;
    }

    public String getPrompt() {
        return prompt;
    }

    public String getResponseText() {
        return responseText;
    }

    public void setResponseText(String responseText) {
        this.responseText = responseText;
    }

    public String getExternalId() {
        return externalId;
    }

    public void setExternalId(String externalId) {
        this.externalId = externalId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
