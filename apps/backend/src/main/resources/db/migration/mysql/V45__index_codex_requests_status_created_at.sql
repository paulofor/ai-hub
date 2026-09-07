CREATE INDEX idx_codex_requests_status_created_at
    ON codex_requests(status, created_at DESC);
