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

    @Column(nullable = false, length = 120)
    private String environment;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String prompt;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "codex_response", columnDefinition = "LONGTEXT")
    private String response;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public CodexRequestRecord() {
    }

    public CodexRequestRecord(String environment, String prompt, String response) {
        this.environment = environment;
        this.prompt = prompt;
        this.response = response;
    }

    public Long getId() {
        return id;
    }

    public String getEnvironment() {
        return environment;
    }

    public String getPrompt() {
        return prompt;
    }

    public String getResponse() {
        return response;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
