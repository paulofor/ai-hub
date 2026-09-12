package com.aihub.hub.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;

import java.sql.DriverManager;
import java.util.HashSet;

import static org.assertj.core.api.Assertions.assertThat;

class CodexRequestMaxWaitMigrationTest {

    @Test
    void migrationCompletesWhenOneOfTheColumnsAlreadyExists() throws Exception {
        String url = "jdbc:h2:mem:codex-max-waits-migration;MODE=MySQL;"
            + "DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";

        try (var connection = DriverManager.getConnection(url, "sa", "");
             var statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE codex_requests (
                    id BIGINT PRIMARY KEY,
                    max_model_reasoning_wait_ms BIGINT
                )
                """);
        }

        Flyway flyway = Flyway.configure()
            .dataSource(url, "sa", "")
            .locations("classpath:db/migration/h2")
            .baselineOnMigrate(true)
            .baselineVersion(MigrationVersion.fromVersion("47"))
            .load();

        var result = flyway.migrate();

        assertThat(result.success).isTrue();
        assertThat(result.targetSchemaVersion).isEqualTo("48");
        try (var connection = DriverManager.getConnection(url, "sa", "");
             var statement = connection.createStatement();
             var columns = statement.executeQuery("""
                 SELECT column_name
                   FROM information_schema.columns
                  WHERE table_name = 'codex_requests'
                    AND column_name IN (
                        'max_model_reasoning_wait_ms',
                        'max_command_execution_wait_ms',
                        'max_external_service_wait_ms'
                    )
                 """)) {
            var columnNames = new HashSet<String>();
            while (columns.next()) {
                columnNames.add(columns.getString("column_name"));
            }
            assertThat(columnNames).containsExactlyInAnyOrder(
                "max_model_reasoning_wait_ms",
                "max_command_execution_wait_ms",
                "max_external_service_wait_ms"
            );
        }
    }
}
