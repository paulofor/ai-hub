SET @environment_active_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'environments'
       AND column_name = 'active'
);
SET @environment_active_ddl = IF(
    @environment_active_exists = 0,
    'ALTER TABLE environments ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE',
    'SELECT 1'
);
PREPARE environment_active_stmt FROM @environment_active_ddl;
EXECUTE environment_active_stmt;
DEALLOCATE PREPARE environment_active_stmt;
