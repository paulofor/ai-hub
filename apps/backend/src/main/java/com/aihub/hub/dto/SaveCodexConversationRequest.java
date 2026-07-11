package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public class SaveCodexConversationRequest {

    private String title;

    private String environment;

    private String model;

    private CodexIntegrationProfile profile;

    @Valid
    @NotEmpty(message = "Informe ao menos uma mensagem para salvar a conversa")
    private List<Message> messages;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public CodexIntegrationProfile getProfile() {
        return profile;
    }

    public void setProfile(CodexIntegrationProfile profile) {
        this.profile = profile;
    }

    public List<Message> getMessages() {
        return messages;
    }

    public void setMessages(List<Message> messages) {
        this.messages = messages;
    }

    public record Message(String role, String content, String createdAt) {
    }
}
