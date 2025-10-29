CREATE TABLE codex_requests (
    id BIGSERIAL PRIMARY KEY,
    environment VARCHAR(120) NOT NULL,
    prompt TEXT NOT NULL,
    codex_response TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_codex_requests_created_at ON codex_requests(created_at);
