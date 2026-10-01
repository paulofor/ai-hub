package com.aihub.hub.service;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CodexModelPricingMigrationTest {
    @Test
    void fixesActivePricesAndAddsGptSixPointOneAcrossDatabaseMigrations() throws Exception {
        Map<String, double[]> expectedPrices = Map.of(
            "gpt-5.6", new double[] { 4.0, 0.4, 20.0 },
            "gpt-5.6-sol", new double[] { 4.0, 0.4, 20.0 },
            "gpt-5.6-terra", new double[] { 2.0, 0.2, 12.0 },
            "gpt-5.6-luna", new double[] { 0.2, 0.02, 1.2 },
            "gpt-6.1-sol", new double[] { 2.0, 0.1, 10.0 }
        );
        Map<String, String> displayNames = Map.of(
            "gpt-5.6", "GPT-5.6",
            "gpt-5.6-sol", "GPT-5.6 Sol",
            "gpt-5.6-terra", "GPT-5.6 Terra",
            "gpt-5.6-luna", "GPT-5.6 Luna",
            "gpt-6.1-sol", "GPT-6.1 Sol"
        );

        for (String dialect : new String[] { "h2", "postgresql", "mysql" }) {
            String sql = Files.readString(Path.of("src/main/resources/db/migration", dialect,
                "V59__sync_codex_model_pricing.sql"));
            for (var expected : expectedPrices.entrySet()) {
                String[] prices = java.util.Arrays.stream(expected.getValue())
                    .mapToObj(price -> String.format(java.util.Locale.ROOT, "%.6f", price))
                    .toArray(String[]::new);
                assertThat(sql).contains("'" + expected.getKey() + "', '" + displayNames.get(expected.getKey())
                    + "', " + String.join(", ", prices) + ", TRUE");
            }
            if (dialect.equals("mysql")) {
                assertThat(sql).contains("ON DUPLICATE KEY UPDATE");
            } else if (dialect.equals("postgresql")) {
                assertThat(sql).contains("ON CONFLICT (model_name) DO UPDATE");
            }
        }

        try (var connection = DriverManager.getConnection("jdbc:h2:mem:codex-pricing-h2");
             var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE codex_model_pricing ("
                + "model_name VARCHAR(191) PRIMARY KEY, display_name VARCHAR(191), "
                + "input_price_per_million DECIMAL(19,6) NOT NULL, "
                + "cached_input_price_per_million DECIMAL(19,6) NOT NULL, "
                + "output_price_per_million DECIMAL(19,6) NOT NULL, active BOOLEAN NOT NULL, "
                + "created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP)");
            statement.execute("INSERT INTO codex_model_pricing VALUES "
                + "('gpt-6-astra', 'GPT-6 Astra', 10, 1, 50, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                + "('gpt-6-sol', 'GPT-6 Sol', 2, 0.2, 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                + "('gpt-6-luna', 'GPT-6 Luna', 0.1, 0.01, 0.5, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                + "('gpt-5.6', 'GPT-5.6', 5, 0.5, 30, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");

            String sql = Files.readString(Path.of("src/main/resources/db/migration", "h2",
                "V59__sync_codex_model_pricing.sql"));
            statement.execute(sql);
            statement.execute(sql);

            for (var expected : expectedPrices.entrySet()) {
                try (var query = connection.prepareStatement("SELECT input_price_per_million, "
                    + "cached_input_price_per_million, output_price_per_million, active "
                    + "FROM codex_model_pricing WHERE model_name = ?")) {
                    query.setString(1, expected.getKey());
                    try (var row = query.executeQuery()) {
                        assertThat(row.next()).isTrue();
                        assertThat(row.getBigDecimal(1).doubleValue()).isEqualTo(expected.getValue()[0]);
                        assertThat(row.getBigDecimal(2).doubleValue()).isEqualTo(expected.getValue()[1]);
                        assertThat(row.getBigDecimal(3).doubleValue()).isEqualTo(expected.getValue()[2]);
                        assertThat(row.getBoolean(4)).isTrue();
                    }
                }
            }
            try (var row = statement.executeQuery("SELECT COUNT(*) FROM codex_model_pricing "
                + "WHERE model_name IN ('gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna') AND active = TRUE")) {
                assertThat(row.next()).isTrue();
                assertThat(row.getInt(1)).isEqualTo(3);
            }
        }
    }
}
