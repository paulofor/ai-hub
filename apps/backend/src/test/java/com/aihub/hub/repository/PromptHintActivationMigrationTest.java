package com.aihub.hub.repository;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PromptHintActivationMigrationTest {
    @Test
    void legacyAndNewItemsDefaultToActiveAndRetryPreservesInactiveAndContent() throws Exception {
        for (String vendor : new String[] { "h2", "postgresql" }) {
            try (var connection = DriverManager.getConnection("jdbc:h2:mem:prompt-hint-migration-" + vendor);
                 var statement = connection.createStatement()) {
                statement.execute("CREATE TABLE prompt_hints (id BIGINT PRIMARY KEY, phrase TEXT)");
                statement.execute("INSERT INTO prompt_hints VALUES (1, 'Conteúdo legado')");
                var migration = new ClassPathResource("db/migration/" + vendor + "/V64__add_prompt_hint_active_status.sql");
                ScriptUtils.executeSqlScript(connection, migration);
                statement.execute("INSERT INTO prompt_hints (id, phrase) VALUES (2, 'Conteúdo novo')");
                try (var rows = statement.executeQuery("SELECT active FROM prompt_hints ORDER BY id")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getBoolean(1)).isTrue();
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getBoolean(1)).isTrue();
                }
                statement.execute("UPDATE prompt_hints SET active = FALSE WHERE id = 1");
                ScriptUtils.executeSqlScript(connection, migration);
                try (var rows = statement.executeQuery("SELECT phrase, active FROM prompt_hints WHERE id = 1")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo("Conteúdo legado");
                    assertThat(rows.getBoolean(2)).isFalse();
                }
                assertThatThrownBy(() -> statement.execute("UPDATE prompt_hints SET active = NULL WHERE id = 1"))
                    .isInstanceOf(java.sql.SQLException.class);
            }
        }
    }
}
