SET @prompt_hint_active_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'prompt_hints'
       AND column_name = 'active'
);
SET @prompt_hint_active_ddl = IF(
    @prompt_hint_active_exists = 0,
    'ALTER TABLE prompt_hints ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE',
    'SELECT 1'
);
PREPARE prompt_hint_active_stmt FROM @prompt_hint_active_ddl;
EXECUTE prompt_hint_active_stmt;
DEALLOCATE PREPARE prompt_hint_active_stmt;
