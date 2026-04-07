package com.aihub.hub.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlywayConfig {

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy(
            @Value("${hub.flyway.repair-on-startup:true}") boolean repairOnStartup) {
        return flyway -> {
            if (repairOnStartup) {
                flyway.repair();
            }
            flyway.migrate();
        };
    }
}
