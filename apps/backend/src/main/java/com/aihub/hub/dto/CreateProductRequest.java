package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateProductRequest(
    @NotBlank(message = "Informe o nome do produto")
    @Size(max = 150, message = "O nome pode ter no máximo 150 caracteres")
    String name,
    @NotBlank(message = "Informe o slug do produto")
    @Size(max = 150, message = "O slug pode ter no máximo 150 caracteres")
    @Pattern(regexp = "^[a-z0-9]+(?:-[a-z0-9]+)*$", message = "Use um slug em minúsculas com letras, números e hífens")
    String slug,
    @NotBlank(message = "Informe o id externo do produto")
    @Size(max = 150, message = "O id externo pode ter no máximo 150 caracteres")
    String externalId
) {
}
