ALTER TABLE codex_requests
    ADD COLUMN version VARCHAR(45) NOT NULL DEFAULT 'aihub-4';

UPDATE codex_requests
SET version = 'aihub-4'
WHERE version IS NULL OR TRIM(version) = '';
