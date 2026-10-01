-- H2 installations skipped V54, which exists only for MySQL and PostgreSQL.
-- Repair forward so existing H2 migration histories remain valid.
ALTER TABLE codex_requests ADD COLUMN IF NOT EXISTS user_message LONGTEXT;
