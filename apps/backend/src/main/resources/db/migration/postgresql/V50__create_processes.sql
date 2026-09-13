CREATE TABLE processes (
    id BIGSERIAL PRIMARY KEY,
    number VARCHAR(80) NOT NULL UNIQUE,
    text VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE codex_requests ADD COLUMN process_number VARCHAR(80);
ALTER TABLE codex_requests ADD COLUMN process_text VARCHAR(500);
