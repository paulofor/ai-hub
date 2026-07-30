package com.aihub.hub.web;

import com.aihub.hub.service.SystemMaintenanceService;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SystemMaintenanceControllerTest {

    @Test
    void reportsWhetherAdminTokenIsConfiguredWithoutExposingIt() {
        var controller = new SystemMaintenanceController(mock(SystemMaintenanceService.class), "top-secret");

        assertThat(controller.configuration()).containsExactlyInAnyOrderEntriesOf(Map.of(
            "configured", true,
            "environmentVariable", "HUB_MAINTENANCE_ADMIN_TOKEN"
        ));
        assertThat(controller.configuration().toString()).doesNotContain("top-secret");
    }

    @Test
    void distinguishesMissingConfigurationFromInvalidToken() {
        var service = mock(SystemMaintenanceService.class);
        var unconfigured = new SystemMaintenanceController(service, "");
        var configured = new SystemMaintenanceController(service, "top-secret");
        when(service.status()).thenReturn(Map.of("status", "ok"));

        assertThatThrownBy(() -> unconfigured.status(null))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("503 SERVICE_UNAVAILABLE");
        assertThatThrownBy(() -> configured.status("wrong"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403 FORBIDDEN");
        assertThat(configured.status("top-secret")).containsEntry("status", "ok");
    }
}
