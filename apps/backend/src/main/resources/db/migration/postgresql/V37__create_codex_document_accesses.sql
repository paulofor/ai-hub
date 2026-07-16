CREATE TABLE codex_document_accesses (
    id BIGSERIAL PRIMARY KEY,
    codex_request_id BIGINT NOT NULL REFERENCES codex_requests(id),
    sandbox_job_id VARCHAR(255) NOT NULL,
    sandbox_access_id VARCHAR(255) NOT NULL,
    document_path TEXT NOT NULL,
    tool_name VARCHAR(64) NOT NULL,
    requested_path TEXT,
    command TEXT,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sandbox_job_id, sandbox_access_id)
);

CREATE INDEX idx_codex_document_accesses_request ON codex_document_accesses (codex_request_id);
CREATE INDEX idx_codex_document_accesses_path ON codex_document_accesses (document_path);
CREATE INDEX idx_codex_document_accesses_path_accessed ON codex_document_accesses (document_path, accessed_at);
