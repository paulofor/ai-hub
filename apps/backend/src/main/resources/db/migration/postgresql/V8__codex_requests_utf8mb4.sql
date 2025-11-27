-- Keep migration sequence aligned; PostgreSQL already supports full Unicode in text columns.
-- Re-apply the type to ensure compatibility if the column was customized.
ALTER TABLE codex_requests
    ALTER COLUMN response_text TYPE TEXT,
    ALTER COLUMN prompt TYPE TEXT;
