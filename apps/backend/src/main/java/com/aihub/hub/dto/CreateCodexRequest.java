package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;

public class CreateCodexRequest {

    @NotBlank
    private String environment;

    @NotBlank
    private String prompt;

    private String model;

    public CreateCodexRequest() {
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public String getPrompt() {
        return prompt;
    }

    public void setPrompt(String prompt) {
        this.prompt = prompt;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }
}
