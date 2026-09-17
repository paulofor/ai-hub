ALTER TABLE codex_requests
    ADD COLUMN IF NOT EXISTS screen_prompt_items_json TEXT;
