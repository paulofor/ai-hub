CREATE TABLE codex_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    environment VARCHAR(120) NOT NULL,
    prompt CLOB NOT NULL,
    codex_response CLOB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_codex_requests_created_at ON codex_requests(created_at);
