package com.aihub.hub.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.LocalDate;

public record UpsertGrowthMissionRequest(
    @NotBlank String product,
    @NotBlank String objective,
    @NotNull @Min(1) Integer targetSales,
    @NotNull @DecimalMin("0.00") BigDecimal budgetLimit,
    LocalDate endsAt,
    @NotBlank String status,
    @NotNull @Min(0) Long visitors,
    @NotNull @Min(0) Long ctaClicks,
    @NotNull @Min(0) Long checkoutsStarted,
    @NotNull @Min(0) Long salesApproved,
    @NotNull @Min(0) Long briefingsCompleted,
    @NotNull @Min(0) Long deliveriesCompleted,
    @NotNull @Min(0) Long refunds,
    @NotNull @DecimalMin("0.00") BigDecimal revenue,
    @NotNull @DecimalMin("0.00") BigDecimal spend
) {
}
