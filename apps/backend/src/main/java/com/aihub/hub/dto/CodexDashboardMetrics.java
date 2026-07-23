package com.aihub.hub.dto;

import java.time.Instant;

public record CodexDashboardMetrics(
    CodexDashboardMetricWindow week,
    CodexDashboardMetricWindow month
) {
    public record CodexDashboardMetricWindow(
        Instant startsAt,
        long requestCount,
        long interactionCount,
        long durationMs
    ) {
    }
}
