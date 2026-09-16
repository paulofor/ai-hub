package com.aihub.hub.config;

import java.time.Duration;
import org.flywaydb.core.api.FlywayException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlywayConfig {

    private static final Logger log = LoggerFactory.getLogger(FlywayConfig.class);

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy(
            @Value("${hub.flyway.repair-on-startup:true}") boolean repairOnStartup,
            @Value("${hub.flyway.retry-initial-delay:5s}") Duration initialDelay,
            @Value("${hub.flyway.retry-max-delay:60s}") Duration maxDelay) {
        return flyway -> {
            int attempt = 0;
            Duration delay = initialDelay;

            while (true) {
                attempt++;
                try {
                    // MySQL DDL commits implicitly. If the connection is lost after
                    // the DDL completes, repair the failed history row before retrying
                    // the idempotent migration with a fresh pooled connection.
                    if (repairOnStartup) {
                        flyway.repair();
                    }
                    flyway.migrate();
                    if (attempt > 1) {
                        log.info("Migrações aplicadas após {} tentativas.", attempt);
                    }
                    return;
                } catch (FlywayException ex) {
                    log.warn(
                            "Falha ao aplicar migrações (tentativa {}). Nova tentativa em {} segundos.",
                            attempt,
                            delay.toSeconds(),
                            ex);
                }

                sleepBeforeRetry(delay);
                delay = delay.multipliedBy(2);
                if (delay.compareTo(maxDelay) > 0) {
                    delay = maxDelay;
                }
            }
        };
    }

    private static void sleepBeforeRetry(Duration delay) {
        try {
            Thread.sleep(delay.toMillis());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Thread interrompida enquanto aguardava nova tentativa de migração do banco de dados.", ex);
        }
    }
}
