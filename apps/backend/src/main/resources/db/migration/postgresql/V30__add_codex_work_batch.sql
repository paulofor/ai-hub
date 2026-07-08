ALTER TABLE codex_requests
    ADD COLUMN work_branch VARCHAR(191),
    ADD COLUMN work_batch_key VARCHAR(191);

CREATE INDEX IF NOT EXISTS idx_codex_requests_work_batch ON codex_requests(work_batch_key, created_at);
