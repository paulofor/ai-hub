package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateEnvironmentRequest(
    @NotBlank(message = "Informe o nome do ambiente")
    @Size(max = 150, message = "O nome pode ter no máximo 150 caracteres")
    String name,
    @Size(max = 255, message = "A descrição pode ter no máximo 255 caracteres")
    String description
) {
}
