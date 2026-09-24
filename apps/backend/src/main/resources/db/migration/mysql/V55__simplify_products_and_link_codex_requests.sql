-- MySQL commits DDL implicitly. Build each ALTER from information_schema so a
-- reconnect after a long table rebuild can safely resume this migration.
SET @products_alter = (
    SELECT CASE
        WHEN SUM(column_name = 'slug') > 0 AND SUM(column_name = 'external_id') > 0
            THEN 'ALTER TABLE products DROP COLUMN slug, DROP COLUMN external_id'
        WHEN SUM(column_name = 'slug') > 0
            THEN 'ALTER TABLE products DROP COLUMN slug'
        WHEN SUM(column_name = 'external_id') > 0
            THEN 'ALTER TABLE products DROP COLUMN external_id'
        ELSE 'SELECT 1'
    END
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'products'
);
PREPARE products_statement FROM @products_alter;
EXECUTE products_statement;
DEALLOCATE PREPARE products_statement;

SET @codex_requests_alter = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE codex_requests ADD COLUMN product_name VARCHAR(150) NULL',
        'SELECT 1'
    )
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'codex_requests'
      AND column_name = 'product_name'
);
PREPARE codex_requests_statement FROM @codex_requests_alter;
EXECUTE codex_requests_statement;
DEALLOCATE PREPARE codex_requests_statement;
