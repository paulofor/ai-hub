package com.aihub.hub.dto;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexReasoningEffort;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;

public class CreateCodexRequest {

    @NotBlank
    private String environment;

    @NotBlank
    private String prompt;

    private String userMessage;

    private String model;

    private CodexReasoningEffort reasoningEffort = CodexReasoningEffort.HIGH;

    private CodexIntegrationProfile profile;

    private Long problemId;

    private Long processId;

    @Size(max = 150, message = "O nome do produto pode ter no máximo 150 caracteres")
    private String productName;

    private Integer promptTokens;

    private Integer cachedPromptTokens;

    private Integer completionTokens;

    private Integer totalTokens;

    private BigDecimal promptCost;

    private BigDecimal cachedPromptCost;

    private BigDecimal completionCost;

    private BigDecimal cost;

    private List<ImageAttachment> imageAttachments;

    private List<ScreenPromptItem> screenPromptItems;

    public CreateCodexRequest() {
    }

    public String getProductName() {
        return productName;
    }

    public void setProductName(String productName) {
        this.productName = productName;
    }

    public List<ImageAttachment> getImageAttachments() {
        return imageAttachments;
    }

    public void setImageAttachments(List<ImageAttachment> imageAttachments) {
        this.imageAttachments = imageAttachments;
    }

    public record ImageAttachment(String name, String mimeType, Long size, String dataUrl) {
    }

    public record ScreenPromptItem(Long id, String label, String phrase) {
    }

    public List<ScreenPromptItem> getScreenPromptItems() {
        return screenPromptItems;
    }

    public void setScreenPromptItems(List<ScreenPromptItem> screenPromptItems) {
        this.screenPromptItems = screenPromptItems;
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

    public String getUserMessage() {
        return userMessage;
    }

    public void setUserMessage(String userMessage) {
        this.userMessage = userMessage;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public CodexReasoningEffort getReasoningEffort() {
        return reasoningEffort;
    }

    public void setReasoningEffort(CodexReasoningEffort reasoningEffort) {
        this.reasoningEffort = reasoningEffort == null ? CodexReasoningEffort.HIGH : reasoningEffort;
    }

    public CodexIntegrationProfile getProfile() {
        return profile;
    }

    public void setProfile(CodexIntegrationProfile profile) {
        this.profile = profile;
    }

    public Long getProblemId() {
        return problemId;
    }

    public void setProblemId(Long problemId) {
        this.problemId = problemId;
    }

    public Long getProcessId() { return processId; }
    public void setProcessId(Long processId) { this.processId = processId; }

    public Integer getPromptTokens() {
        return promptTokens;
    }

    public void setPromptTokens(Integer promptTokens) {
        this.promptTokens = promptTokens;
    }

    public Integer getCachedPromptTokens() {
        return cachedPromptTokens;
    }

    public void setCachedPromptTokens(Integer cachedPromptTokens) {
        this.cachedPromptTokens = cachedPromptTokens;
    }

    public Integer getCompletionTokens() {
        return completionTokens;
    }

    public void setCompletionTokens(Integer completionTokens) {
        this.completionTokens = completionTokens;
    }

    public Integer getTotalTokens() {
        return totalTokens;
    }

    public void setTotalTokens(Integer totalTokens) {
        this.totalTokens = totalTokens;
    }

    public BigDecimal getPromptCost() {
        return promptCost;
    }

    public void setPromptCost(BigDecimal promptCost) {
        this.promptCost = promptCost;
    }

    public BigDecimal getCachedPromptCost() {
        return cachedPromptCost;
    }

    public void setCachedPromptCost(BigDecimal cachedPromptCost) {
        this.cachedPromptCost = cachedPromptCost;
    }

    public BigDecimal getCompletionCost() {
        return completionCost;
    }

    public void setCompletionCost(BigDecimal completionCost) {
        this.completionCost = completionCost;
    }

    public BigDecimal getCost() {
        return cost;
    }

    public void setCost(BigDecimal cost) {
        this.cost = cost;
    }
}
