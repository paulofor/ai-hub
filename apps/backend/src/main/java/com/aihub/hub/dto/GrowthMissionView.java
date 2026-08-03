package com.aihub.hub.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public record GrowthMissionView(
    Long id, String product, String objective, Integer targetSales, BigDecimal budgetLimit,
    LocalDate endsAt, String status, Long visitors, Long ctaClicks, Long checkoutsStarted,
    Long salesApproved, Long briefingsCompleted, Long deliveriesCompleted, Long refunds,
    BigDecimal revenue, BigDecimal spend, BigDecimal cac, BigDecimal conversionRate,
    String bottleneck, String recommendedAction, String metricsSource, Long receivedEvents,
    Instant lastEventAt, Instant updatedAt
) {
}
