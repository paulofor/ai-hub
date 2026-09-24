package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateProductRequest(
    @NotBlank(message = "Informe o nome do produto")
    @Size(max = 150, message = "O nome pode ter no máximo 150 caracteres")
    String name
) {
}
