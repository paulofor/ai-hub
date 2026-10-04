-- V26 added this required column in H2/PostgreSQL, but not in MySQL.
-- Preserve provisioned databases and support retries after implicit DDL commits.
-- Match the legacy default in V26; new requests explicitly use their own version.
SET @codex_version_alter = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE codex_requests ADD COLUMN version VARCHAR(45) NOT NULL DEFAULT ''aihub-4''',
        'SELECT 1'
    )
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'codex_requests'
      AND column_name = 'version'
);
PREPARE codex_version_statement FROM @codex_version_alter;
EXECUTE codex_version_statement;
DEALLOCATE PREPARE codex_version_statement;
