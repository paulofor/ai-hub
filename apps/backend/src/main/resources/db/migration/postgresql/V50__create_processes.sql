CREATE TABLE processes (
    id BIGSERIAL PRIMARY KEY,
    number VARCHAR(80) NOT NULL UNIQUE,
    text VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE codex_request_processes (
    request_id BIGINT PRIMARY KEY,
    process_number VARCHAR(80) NOT NULL,
    process_text VARCHAR(500) NOT NULL,
    CONSTRAINT fk_codex_request_processes_request FOREIGN KEY (request_id) REFERENCES codex_requests (id) ON DELETE CASCADE
);
