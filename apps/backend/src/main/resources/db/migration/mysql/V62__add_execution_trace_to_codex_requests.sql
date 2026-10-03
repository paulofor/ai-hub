SET @execution_trace_exists = (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'codex_requests' AND column_name = 'execution_trace'
);
SET @execution_trace_ddl = IF(
    @execution_trace_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN execution_trace LONGTEXT NULL',
    'SELECT 1'
);
PREPARE execution_trace_stmt FROM @execution_trace_ddl;
EXECUTE execution_trace_stmt;
DEALLOCATE PREPARE execution_trace_stmt;
