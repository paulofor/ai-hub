SET @reasoning_summary_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'reasoning_summary'
);
SET @reasoning_summary_ddl = IF(
    @reasoning_summary_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN reasoning_summary LONGTEXT NULL',
    'SELECT 1'
);
PREPARE reasoning_summary_stmt FROM @reasoning_summary_ddl;
EXECUTE reasoning_summary_stmt;
DEALLOCATE PREPARE reasoning_summary_stmt;
