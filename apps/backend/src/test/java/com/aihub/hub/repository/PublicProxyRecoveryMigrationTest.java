package com.aihub.hub.repository;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import java.sql.DriverManager;
import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PublicProxyRecoveryMigrationTest {

    @Test
    void h2MigrationsCreateRecoveryTableWithIdempotencyConstraint() throws Exception {
        String url = "jdbc:h2:mem:public-proxy-recovery-migration;MODE=MySQL;"
            + "DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1";
        Flyway flyway = Flyway.configure()
            .dataSource(url, "sa", "")
            .locations("classpath:db/migration/h2")
            .load();

        var result = flyway.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.targetSchemaVersion).isEqualTo("44");

        try (var connection = DriverManager.getConnection(url, "sa", "");
             var statement = connection.createStatement()) {
            try (var tables = statement.executeQuery("""
                SELECT COUNT(*)
                  FROM information_schema.tables
                 WHERE table_name = 'public_proxy_recoveries'
                """)) {
                assertThat(tables.next()).isTrue();
                assertThat(tables.getInt(1)).isEqualTo(1);
            }

            statement.executeUpdate("""
                INSERT INTO public_proxy_recoveries
                    (request_id, reason, status, requested_at, updated_at)
                VALUES
                    ('ef45d85f-7f85-4a44-a0bb-2ad4ec94b38e', 'primeiro motivo', 'REQUESTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """);
            assertThatThrownBy(() -> statement.executeUpdate("""
                INSERT INTO public_proxy_recoveries
                    (request_id, reason, status, requested_at, updated_at)
                VALUES
                    ('ef45d85f-7f85-4a44-a0bb-2ad4ec94b38e', 'motivo repetido', 'REQUESTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """))
                .isInstanceOf(SQLException.class);
        }
    }
}
