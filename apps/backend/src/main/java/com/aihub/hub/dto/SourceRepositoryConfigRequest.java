package com.aihub.hub.dto;

import jakarta.validation.constraints.Size;

public record SourceRepositoryConfigRequest(
    @Size(max = 150, message = "O nome de usuário ou organização pode ter no máximo 150 caracteres")
    String owner,
    @Size(max = 150, message = "O repositório pode ter no máximo 150 caracteres")
    String repo,
    @Size(max = 150, message = "A branch pode ter no máximo 150 caracteres")
    String branch,
    @Size(max = 512, message = "O token pode ter no máximo 512 caracteres")
    String token
) {
}
