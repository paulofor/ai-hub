package com.aihub.hub.repository;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;

class ProductSimplificationMigrationTest {
    @Test
    void mysqlMigrationIsResumableAfterImplicitDdlCommit() throws Exception {
        String sql = Files.readString(Path.of("src/main/resources/db/migration/mysql",
            "V55__simplify_products_and_link_codex_requests.sql"));

        assertThat(sql).doesNotContain("DROP INDEX uk_products_slug", "DROP INDEX uk_products_external_id");
        assertThat(sql)
            .contains("FROM information_schema.columns")
            .contains("WHEN SUM(column_name = 'slug') > 0")
            .contains("WHEN SUM(column_name = 'external_id') > 0")
            .contains("ALTER TABLE products DROP COLUMN slug, DROP COLUMN external_id")
            .contains("AND column_name = 'product_name'")
            .contains("ALTER TABLE codex_requests ADD COLUMN product_name VARCHAR(150) NULL")
            .contains("ELSE 'SELECT 1'");
    }
}
