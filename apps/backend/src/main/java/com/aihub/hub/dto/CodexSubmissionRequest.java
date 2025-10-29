package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;

public record CodexSubmissionRequest(
    @NotBlank(message = "O prompt é obrigatório") String prompt,
    @NotBlank(message = "O ambiente é obrigatório") String environment
) {
}
