package com.aihub.hub.repository;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;

class EnvironmentActivationMigrationTest {
    @Test
    void existingAndNewEnvironmentsDefaultToActiveAndRetryPreservesInactive() throws Exception {
        for (String vendor : new String[] { "h2", "postgresql" }) {
            try (var connection = DriverManager.getConnection("jdbc:h2:mem:environment-migration-" + vendor, "sa", "");
                 var statement = connection.createStatement()) {
                statement.execute("CREATE TABLE environments (id BIGINT PRIMARY KEY, name VARCHAR(150))");
                statement.execute("INSERT INTO environments (id, name) VALUES (1, 'test/existing')");
                var migration = new ClassPathResource("db/migration/" + vendor + "/V60__add_environment_active_status.sql");
                ScriptUtils.executeSqlScript(connection, migration);
                statement.execute("INSERT INTO environments (id, name) VALUES (2, 'test/new')");
                try (var rows = statement.executeQuery("SELECT active FROM environments ORDER BY id")) {
                    while (rows.next()) assertThat(rows.getBoolean(1)).isTrue();
                }
                statement.execute("UPDATE environments SET active = FALSE WHERE id = 1");
                ScriptUtils.executeSqlScript(connection, migration);
                try (var rows = statement.executeQuery("SELECT active FROM environments WHERE id = 1")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getBoolean(1)).isFalse();
                }
            }
        }
    }
}
