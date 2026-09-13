package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ProcessRequest(
    @NotBlank(message = "Informe o número do processo") @Size(max = 80) String number,
    @NotBlank(message = "Informe o texto do processo") @Size(max = 500) String text
) {}
