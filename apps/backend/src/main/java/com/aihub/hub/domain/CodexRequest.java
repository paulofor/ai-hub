package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "codex_requests")
public class CodexRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String environment;

    @Column(nullable = false)
    private String model;

    @Enumerated(EnumType.STRING)
    @Column(name = "profile", nullable = false)
    private CodexIntegrationProfile profile = CodexIntegrationProfile.STANDARD;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "LONGTEXT", nullable = false)
    private String prompt;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "response_text", columnDefinition = "LONGTEXT")
    private String responseText;

    @Column(name = "external_id")
    private String externalId;

    @Column(name = "prompt_tokens")
    private Integer promptTokens;

    @Column(name = "cached_prompt_tokens")
    private Integer cachedPromptTokens;

    @Column(name = "completion_tokens")
    private Integer completionTokens;

    @Column(name = "total_tokens")
    private Integer totalTokens;

    @Column(name = "prompt_cost", precision = 19, scale = 6)
    private BigDecimal promptCost;

    @Column(name = "cached_prompt_cost", precision = 19, scale = 6)
    private BigDecimal cachedPromptCost;

    @Column(name = "completion_cost", precision = 19, scale = 6)
    private BigDecimal completionCost;

    @Column(name = "cost", precision = 19, scale = 6)
    private BigDecimal cost;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public CodexRequest() {
    }

    public CodexRequest(String environment, String model, CodexIntegrationProfile profile, String prompt) {
        this.environment = environment;
        this.model = model;
        this.profile = profile;
        this.prompt = prompt;
    }

    public Long getId() {
        return id;
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
        this.profile = profile != null ? profile : CodexIntegrationProfile.STANDARD;
    }

    public String getPrompt() {
        return prompt;
    }

    public void setPrompt(String prompt) {
        this.prompt = prompt;
    }

    public String getResponseText() {
        return responseText;
    }

    public void setResponseText(String responseText) {
        this.responseText = responseText;
    }

    public String getExternalId() {
        return externalId;
    }

    public void setExternalId(String externalId) {
        this.externalId = externalId;
    }

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

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
