ALTER TABLE codex_requests
    ADD COLUMN IF NOT EXISTS user_message TEXT;
