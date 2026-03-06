ALTER TABLE codex_requests
    ADD COLUMN version VARCHAR(45) DEFAULT 'aihub-4';

UPDATE codex_requests
SET version = 'aihub-4'
WHERE version IS NULL OR TRIM(version) = '';

ALTER TABLE codex_requests
    ALTER COLUMN version SET NOT NULL;
