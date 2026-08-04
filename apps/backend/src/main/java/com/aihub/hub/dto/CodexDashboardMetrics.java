package com.aihub.hub.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;

public record CodexDashboardMetrics(
    CodexDashboardMetricWindow day,
    CodexDashboardMetricWindow week,
    CodexDashboardMetricWindow month,
    CodexDashboardMetricSeries series,
    CodexSalesImpactScore salesImpactDay,
    CodexSalesImpactScore salesImpactWeek,
    CodexSalesImpactScore salesImpactMonth
) {
    public record CodexDashboardMetricWindow(
        Instant startsAt,
        long requestCount,
        long interactionCount,
        long durationMs
    ) {
    }

    public record CodexSalesImpactScore(
        long muitoBaixo,
        long baixo,
        long medio,
        long alto,
        long muitoAlto
    ) {
        @JsonProperty("total")
        public long total() {
            return muitoBaixo + baixo + medio + alto + muitoAlto;
        }
    }

    public record CodexDashboardMetricSeries(
        List<CodexDashboardMetricWindow> daily,
        List<CodexDashboardMetricWindow> weekly,
        List<CodexDashboardMetricWindow> monthly
    ) {
    }
}
