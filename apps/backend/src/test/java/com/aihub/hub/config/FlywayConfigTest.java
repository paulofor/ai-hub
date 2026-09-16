package com.aihub.hub.config;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class FlywayConfigTest {

    @Test
    void repairsAndRetriesMigrationAfterTransientConnectionFailure() {
        Flyway flyway = mock(Flyway.class);
        when(flyway.migrate()).thenThrow(new FlywayException("Connection is closed")).thenReturn(null);

        var strategy = new FlywayConfig()
                .flywayMigrationStrategy(true, Duration.ZERO, Duration.ZERO);

        strategy.migrate(flyway);

        verify(flyway, times(2)).repair();
        verify(flyway, times(2)).migrate();
        InOrder calls = inOrder(flyway);
        calls.verify(flyway).repair();
        calls.verify(flyway).migrate();
        calls.verify(flyway).repair();
        calls.verify(flyway).migrate();
    }

    @Test
    void canMigrateWithoutAutomaticRepair() {
        Flyway flyway = mock(Flyway.class);

        var strategy = new FlywayConfig()
                .flywayMigrationStrategy(false, Duration.ZERO, Duration.ZERO);

        strategy.migrate(flyway);

        verify(flyway).migrate();
    }
}
