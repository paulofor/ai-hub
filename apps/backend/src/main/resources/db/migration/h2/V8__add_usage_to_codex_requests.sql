ALTER TABLE codex_requests ADD COLUMN prompt_tokens INT;
ALTER TABLE codex_requests ADD COLUMN completion_tokens INT;
ALTER TABLE codex_requests ADD COLUMN total_tokens INT;
ALTER TABLE codex_requests ADD COLUMN cost DECIMAL(19,6);
