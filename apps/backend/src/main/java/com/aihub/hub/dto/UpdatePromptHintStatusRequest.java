package com.aihub.hub.dto;

import jakarta.validation.constraints.NotNull;

public record UpdatePromptHintStatusRequest(
    @NotNull(message = "Informe se o item está ativo") Boolean active
) {
}
