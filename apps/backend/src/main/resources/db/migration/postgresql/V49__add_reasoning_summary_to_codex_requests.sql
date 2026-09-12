ALTER TABLE codex_requests
    ADD COLUMN IF NOT EXISTS reasoning_summary TEXT;
