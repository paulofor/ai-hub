package com.aihub.hub.service;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import static org.assertj.core.api.Assertions.assertThat;

class CodexReasoningSummaryMigrationTest {
    @Test
    void h2AndPostgresqlMigrationPreserveExistingRowsAndCanRunTwice() throws Exception {
        for (String dialect : new String[] { "h2", "postgresql" }) {
            try (var connection = DriverManager.getConnection("jdbc:h2:mem:summary-migration-" + dialect);
                 var statement = connection.createStatement()) {
                statement.execute("CREATE TABLE codex_requests (id BIGINT PRIMARY KEY, response_text TEXT)");
                statement.execute("INSERT INTO codex_requests VALUES (1, 'Resposta antiga')");
                String sql = Files.readString(Path.of("src/main/resources/db/migration", dialect,
                    "V49__add_reasoning_summary_to_codex_requests.sql"));
                statement.execute(sql);
                statement.execute(sql);
                try (var row = statement.executeQuery("SELECT response_text, reasoning_summary FROM codex_requests")) {
                    assertThat(row.next()).isTrue();
                    assertThat(row.getString(1)).isEqualTo("Resposta antiga");
                    assertThat(row.getString(2)).isNull();
                }
                String summary = "Resumo público.\n".repeat(5000);
                try (var update = connection.prepareStatement("UPDATE codex_requests SET reasoning_summary=? WHERE id=1")) {
                    update.setString(1, summary);
                    assertThat(update.executeUpdate()).isEqualTo(1);
                }
                try (var row = statement.executeQuery("SELECT reasoning_summary FROM codex_requests")) {
                    assertThat(row.next()).isTrue();
                    assertThat(row.getString(1)).isEqualTo(summary);
                }
            }
        }
    }
}
