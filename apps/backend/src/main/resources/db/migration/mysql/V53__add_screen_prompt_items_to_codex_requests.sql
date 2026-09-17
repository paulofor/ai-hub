SET @screen_prompt_items_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'screen_prompt_items_json'
);
SET @screen_prompt_items_ddl = IF(
    @screen_prompt_items_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN screen_prompt_items_json LONGTEXT NULL',
    'SELECT 1'
);
PREPARE screen_prompt_items_stmt FROM @screen_prompt_items_ddl;
EXECUTE screen_prompt_items_stmt;
DEALLOCATE PREPARE screen_prompt_items_stmt;
