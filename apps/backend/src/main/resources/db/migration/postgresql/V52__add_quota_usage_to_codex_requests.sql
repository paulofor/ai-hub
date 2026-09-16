ALTER TABLE codex_requests
    ADD COLUMN IF NOT EXISTS quota_usage TEXT;
