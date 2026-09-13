-- Keep this migration retry-safe: MySQL DDL commits implicitly, so a lost
-- connection after CREATE TABLE must not make the next Flyway attempt fail.
CREATE TABLE IF NOT EXISTS processes (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    number VARCHAR(80) NOT NULL,
    text VARCHAR(500) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uk_processes_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Do not ALTER the large codex_requests table during startup. Keeping the
-- optional snapshot in a companion table makes this migration metadata-only.
CREATE TABLE IF NOT EXISTS codex_request_processes (
    request_id BIGINT NOT NULL,
    process_number VARCHAR(80) NOT NULL,
    process_text VARCHAR(500) NOT NULL,
    PRIMARY KEY (request_id),
    CONSTRAINT fk_codex_request_processes_request
        FOREIGN KEY (request_id) REFERENCES codex_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
