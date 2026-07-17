ALTER TABLE codex_requests ADD COLUMN status VARCHAR(32) DEFAULT 'PENDING';
ALTER TABLE codex_requests ADD COLUMN rating INT;
ALTER TABLE codex_requests ADD COLUMN started_at TIMESTAMP;
ALTER TABLE codex_requests ADD COLUMN finished_at TIMESTAMP;
ALTER TABLE codex_requests ADD COLUMN duration_ms BIGINT;
ALTER TABLE codex_requests ADD COLUMN timeout_count INT;

UPDATE codex_requests SET status = COALESCE(status, 'PENDING');

ALTER TABLE codex_requests ALTER COLUMN status SET NOT NULL;
ALTER TABLE codex_requests ALTER COLUMN status DROP DEFAULT;
