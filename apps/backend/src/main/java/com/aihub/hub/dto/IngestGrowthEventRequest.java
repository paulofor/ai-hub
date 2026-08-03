package com.aihub.hub.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record IngestGrowthEventRequest(
    @NotBlank @Size(max = 40) String type,
    @NotBlank @Size(max = 80) String source,
    @NotBlank @Size(max = 190) String eventId,
    @NotBlank @Size(max = 150) String product,
    @NotNull @DecimalMin("0.00") BigDecimal amount,
    Instant occurredAt
) { }
