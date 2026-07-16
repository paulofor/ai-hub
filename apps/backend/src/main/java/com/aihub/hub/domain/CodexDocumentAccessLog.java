package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

@Entity
@Table(
    name = "codex_document_accesses",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_codex_document_access_job_access", columnNames = {"sandbox_job_id", "sandbox_access_id"})
    }
)
public class CodexDocumentAccessLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "codex_request_id", nullable = false)
    private CodexRequest codexRequest;

    @Column(name = "sandbox_job_id", nullable = false)
    private String sandboxJobId;

    @Column(name = "sandbox_access_id", nullable = false)
    private String sandboxAccessId;

    @Column(name = "document_path", nullable = false, length = 2048)
    private String documentPath;

    @Column(name = "tool_name", nullable = false, length = 64)
    private String toolName;

    @Column(name = "requested_path", length = 2048)
    private String requestedPath;

    @Column(name = "command", length = 4096)
    private String command;

    @Column(name = "accessed_at")
    private Instant accessedAt = Instant.now();

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public CodexDocumentAccessLog() {
    }

    public CodexDocumentAccessLog(
        CodexRequest codexRequest,
        String sandboxJobId,
        String sandboxAccessId,
        String documentPath,
        String toolName,
        String requestedPath,
        String command,
        Instant accessedAt
    ) {
        this.codexRequest = codexRequest;
        this.sandboxJobId = sandboxJobId;
        this.sandboxAccessId = sandboxAccessId;
        this.documentPath = documentPath;
        this.toolName = toolName;
        this.requestedPath = requestedPath;
        this.command = command;
        this.accessedAt = accessedAt != null ? accessedAt : Instant.now();
    }

    public Long getId() {
        return id;
    }

    public CodexRequest getCodexRequest() {
        return codexRequest;
    }

    public String getSandboxJobId() {
        return sandboxJobId;
    }

    public String getSandboxAccessId() {
        return sandboxAccessId;
    }

    public String getDocumentPath() {
        return documentPath;
    }

    public String getToolName() {
        return toolName;
    }

    public String getRequestedPath() {
        return requestedPath;
    }

    public String getCommand() {
        return command;
    }

    public Instant getAccessedAt() {
        return accessedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
