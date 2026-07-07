package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;

public class UpdatePendingCodexRequest {

    @NotBlank
    private String prompt;

    public UpdatePendingCodexRequest() {
    }

    public String getPrompt() {
        return prompt;
    }

    public void setPrompt(String prompt) {
        this.prompt = prompt;
    }
}
