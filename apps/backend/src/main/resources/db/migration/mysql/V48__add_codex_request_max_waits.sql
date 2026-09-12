-- This migration may meet a schema that was changed outside Flyway (for
-- example, during an interrupted rollout). MySQL 5.7 has no
-- `ADD COLUMN IF NOT EXISTS`, so check each column independently and preserve
-- any column that is already present.
SET @max_model_reasoning_wait_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'max_model_reasoning_wait_ms'
);
SET @max_model_reasoning_wait_ddl = IF(
    @max_model_reasoning_wait_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN max_model_reasoning_wait_ms BIGINT NULL',
    'SELECT 1'
);
PREPARE max_model_reasoning_wait_stmt FROM @max_model_reasoning_wait_ddl;
EXECUTE max_model_reasoning_wait_stmt;
DEALLOCATE PREPARE max_model_reasoning_wait_stmt;

SET @max_command_execution_wait_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'max_command_execution_wait_ms'
);
SET @max_command_execution_wait_ddl = IF(
    @max_command_execution_wait_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN max_command_execution_wait_ms BIGINT NULL',
    'SELECT 1'
);
PREPARE max_command_execution_wait_stmt FROM @max_command_execution_wait_ddl;
EXECUTE max_command_execution_wait_stmt;
DEALLOCATE PREPARE max_command_execution_wait_stmt;

SET @max_external_service_wait_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'max_external_service_wait_ms'
);
SET @max_external_service_wait_ddl = IF(
    @max_external_service_wait_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN max_external_service_wait_ms BIGINT NULL',
    'SELECT 1'
);
PREPARE max_external_service_wait_stmt FROM @max_external_service_wait_ddl;
EXECUTE max_external_service_wait_stmt;
DEALLOCATE PREPARE max_external_service_wait_stmt;
