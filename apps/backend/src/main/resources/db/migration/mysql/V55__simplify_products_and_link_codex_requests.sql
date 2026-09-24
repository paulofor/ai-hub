ALTER TABLE products DROP COLUMN slug;
ALTER TABLE products DROP COLUMN external_id;
ALTER TABLE codex_requests ADD COLUMN product_name VARCHAR(150) NULL;
