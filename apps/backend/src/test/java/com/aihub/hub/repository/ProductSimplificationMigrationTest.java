package com.aihub.hub.repository;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.ArrayList;

import static org.assertj.core.api.Assertions.assertThat;

class ProductSimplificationMigrationTest {
    @Test
    void mysqlMigrationDoesNotDependOnLegacyIndexNames() throws Exception {
        String sql = Files.readString(Path.of("src/main/resources/db/migration/mysql",
            "V55__simplify_products_and_link_codex_requests.sql"));

        assertThat(sql).doesNotContain("DROP INDEX uk_products_slug", "DROP INDEX uk_products_external_id");

        try (var connection = DriverManager.getConnection("jdbc:h2:mem:product-simplification;MODE=MySQL");
             var statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE products (
                    id BIGINT PRIMARY KEY,
                    name VARCHAR(150) NOT NULL,
                    slug VARCHAR(150) NOT NULL UNIQUE,
                    external_id VARCHAR(150) NOT NULL UNIQUE
                );
                CREATE TABLE codex_requests (id BIGINT PRIMARY KEY);
                """);

            statement.execute(sql);

            try (var columns = connection.getMetaData().getColumns(null, null, "PRODUCTS", null)) {
                var columnNames = new ArrayList<String>();
                while (columns.next()) {
                    columnNames.add(columns.getString("COLUMN_NAME"));
                }
                assertThat(columnNames).containsExactly("ID", "NAME");
            }
            try (var columns = connection.getMetaData().getColumns(null, null, "CODEX_REQUESTS", "PRODUCT_NAME")) {
                assertThat(columns.next()).isTrue();
                assertThat(columns.getInt("COLUMN_SIZE")).isEqualTo(150);
            }
        }
    }
}
