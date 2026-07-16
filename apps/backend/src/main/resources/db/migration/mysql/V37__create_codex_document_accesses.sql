CREATE TABLE codex_document_accesses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    codex_request_id BIGINT NOT NULL,
    sandbox_job_id VARCHAR(255) NOT NULL,
    sandbox_access_id VARCHAR(255) NOT NULL,
    document_path TEXT NOT NULL,
    tool_name VARCHAR(64) NOT NULL,
    requested_path TEXT,
    command TEXT,
    accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_codex_document_accesses_request FOREIGN KEY (codex_request_id) REFERENCES codex_requests(id),
    CONSTRAINT uq_codex_document_accesses_job_access UNIQUE (sandbox_job_id, sandbox_access_id)
);

CREATE INDEX idx_codex_document_accesses_request ON codex_document_accesses (codex_request_id);
CREATE INDEX idx_codex_document_accesses_path ON codex_document_accesses (document_path(255));
CREATE INDEX idx_codex_document_accesses_path_accessed ON codex_document_accesses (document_path(255), accessed_at);
