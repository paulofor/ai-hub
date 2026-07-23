package com.aihub.hub.dto;

import java.time.Instant;
import java.util.List;

public record CodexDashboardMetrics(
    CodexDashboardMetricWindow day,
    CodexDashboardMetricWindow week,
    CodexDashboardMetricWindow month,
    CodexDashboardMetricSeries series
) {
    public record CodexDashboardMetricWindow(
        Instant startsAt,
        long requestCount,
        long interactionCount,
        long durationMs
    ) {
    }

    public record CodexDashboardMetricSeries(
        List<CodexDashboardMetricWindow> daily,
        List<CodexDashboardMetricWindow> weekly,
        List<CodexDashboardMetricWindow> monthly
    ) {
    }
}
