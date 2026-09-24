ALTER TABLE products DROP CONSTRAINT uk_products_slug;
ALTER TABLE products DROP CONSTRAINT uk_products_external_id;
ALTER TABLE products DROP COLUMN slug, DROP COLUMN external_id;
ALTER TABLE codex_requests ADD COLUMN product_name VARCHAR(150);
