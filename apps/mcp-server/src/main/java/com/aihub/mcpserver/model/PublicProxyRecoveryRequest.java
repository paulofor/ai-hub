package com.aihub.mcpserver.model;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record PublicProxyRecoveryRequest(
        @NotNull UUID requestId,
        @NotBlank @Size(min = 8, max = 500) @Pattern(regexp = "^[^\\p{Cntrl}]+$") String reason,
        @NotBlank @Pattern(regexp = "^RECOVER_PUBLIC_PROXY$") String confirmation
) {

    @JsonAnySetter
    public void rejectUnknownField(String field, Object ignoredValue) {
        throw new IllegalArgumentException("Campo não permitido na recuperação: " + field);
    }
}
