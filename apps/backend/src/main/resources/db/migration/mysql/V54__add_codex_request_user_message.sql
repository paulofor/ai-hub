SET @user_message_exists = (
    SELECT COUNT(*)
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'codex_requests'
       AND column_name = 'user_message'
);
SET @user_message_ddl = IF(
    @user_message_exists = 0,
    'ALTER TABLE codex_requests ADD COLUMN user_message LONGTEXT NULL',
    'SELECT 1'
);
PREPARE user_message_stmt FROM @user_message_ddl;
EXECUTE user_message_stmt;
DEALLOCATE PREPARE user_message_stmt;
