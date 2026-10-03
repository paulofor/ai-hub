package com.aihub.hub.service;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import static org.assertj.core.api.Assertions.assertThat;

class CodexExecutionTraceMigrationTest {
    @Test
    void additiveMigrationKeepsLegacySummaryAndSupportsIdempotentExecution() throws Exception {
        for (String dialect : new String[] { "h2", "postgresql" }) {
            try (var connection = DriverManager.getConnection("jdbc:h2:mem:trace-migration-" + dialect);
                 var statement = connection.createStatement()) {
                statement.execute("CREATE TABLE codex_requests (id BIGINT PRIMARY KEY, reasoning_summary TEXT)");
                statement.execute("INSERT INTO codex_requests VALUES (1, 'Resumo antigo')");
                String sql = Files.readString(Path.of("src/main/resources/db/migration", dialect, "V62__add_execution_trace_to_codex_requests.sql"));
                statement.execute(sql);
                statement.execute(sql);
                try (var row = statement.executeQuery("SELECT reasoning_summary, execution_trace FROM codex_requests")) {
                    assertThat(row.next()).isTrue();
                    assertThat(row.getString(1)).isEqualTo("Resumo antigo");
                    assertThat(row.getString(2)).isNull();
                }
            }
        }
    }
}
