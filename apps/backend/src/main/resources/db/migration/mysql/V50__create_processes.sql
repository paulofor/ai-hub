CREATE TABLE processes (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    number VARCHAR(80) NOT NULL,
    text VARCHAR(500) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    UNIQUE KEY uk_processes_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE codex_requests ADD COLUMN process_number VARCHAR(80), ADD COLUMN process_text VARCHAR(500);
