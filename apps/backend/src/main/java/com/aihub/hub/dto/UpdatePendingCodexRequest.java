package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;

public class UpdatePendingCodexRequest {

    @NotBlank
    private String prompt;

    private String userMessage;

    public UpdatePendingCodexRequest() {
    }

    public String getPrompt() {
        return prompt;
    }

    public void setPrompt(String prompt) {
        this.prompt = prompt;
    }

    public String getUserMessage() {
        return userMessage;
    }

    public void setUserMessage(String userMessage) {
        this.userMessage = userMessage;
    }
}
