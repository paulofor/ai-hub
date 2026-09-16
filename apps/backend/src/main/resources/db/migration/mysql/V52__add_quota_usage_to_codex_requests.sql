SET @quota_usage_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'quota_usage'
);
SET @quota_usage_ddl = IF(
    @quota_usage_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN quota_usage LONGTEXT NULL',
    'SELECT 1'
);
PREPARE quota_usage_stmt FROM @quota_usage_ddl;
EXECUTE quota_usage_stmt;
DEALLOCATE PREPARE quota_usage_stmt;
