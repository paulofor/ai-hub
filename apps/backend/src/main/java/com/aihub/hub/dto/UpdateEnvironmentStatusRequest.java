package com.aihub.hub.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateEnvironmentStatusRequest(
    @NotNull(message = "Informe se o ambiente está ativo") Boolean active
) {
}
