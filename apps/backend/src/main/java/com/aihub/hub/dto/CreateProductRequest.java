package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;

public record CreateProductRequest(
    @NotBlank(message = "Informe o nome do produto")
    @Size(max = 150, message = "O nome pode ter no máximo 150 caracteres")
    String name,
    @Size(max = 150, message = "O modelo pode ter no máximo 150 caracteres")
    String modelName,
    @Pattern(regexp = "(?i)low|medium|high|xhigh|max", message = "O raciocínio deve ser low, medium, high, xhigh ou max")
    String reasoningEffort
) {
}
