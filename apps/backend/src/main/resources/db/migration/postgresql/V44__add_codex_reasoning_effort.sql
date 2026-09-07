ALTER TABLE codex_requests
    ADD COLUMN reasoning_effort VARCHAR(16) NOT NULL DEFAULT 'HIGH';
