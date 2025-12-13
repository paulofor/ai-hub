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
import java.util.Objects;

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

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private CodexRequestStatus status = CodexRequestStatus.PENDING;

    @Column(name = "rating")
    private Integer rating;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "response_text", columnDefinition = "LONGTEXT")
    private String responseText;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "user_comment", columnDefinition = "LONGTEXT")
    private String userComment;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "problem_description", columnDefinition = "LONGTEXT")
    private String problemDescription;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "resolution_difficulty", columnDefinition = "LONGTEXT")
    private String resolutionDifficulty;

    @Column(name = "external_id")
    private String externalId;

    @Column(name = "pull_request_url")
    private String pullRequestUrl;

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

    @Column(name = "timeout_count")
    private Integer timeoutCount;

    @Column(name = "http_get_count")
    private Integer httpGetCount;

    @Column(name = "db_query_count")
    private Integer dbQueryCount;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public CodexRequest() {
    }

    public CodexRequest(String environment, String model, CodexIntegrationProfile profile, String prompt) {
        this.environment = environment;
        this.model = model;
        this.profile = profile;
        this.prompt = prompt;
        this.status = CodexRequestStatus.PENDING;
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

    public CodexRequestStatus getStatus() {
        return status;
    }

    public void setStatus(CodexRequestStatus status) {
        this.status = status;
    }

    public Integer getRating() {
        return rating;
    }

    public void setRating(Integer rating) {
        if (rating != null && (rating < 1 || rating > 5)) {
            throw new IllegalArgumentException("rating deve estar entre 1 e 5");
        }
        this.rating = rating;
    }

    public String getResponseText() {
        return responseText;
    }

    public void setResponseText(String responseText) {
        this.responseText = responseText;
    }

    public String getUserComment() {
        return userComment;
    }

    public void setUserComment(String userComment) {
        this.userComment = userComment;
    }

    public String getProblemDescription() {
        return problemDescription;
    }

    public void setProblemDescription(String problemDescription) {
        this.problemDescription = problemDescription;
    }

    public String getResolutionDifficulty() {
        return resolutionDifficulty;
    }

    public void setResolutionDifficulty(String resolutionDifficulty) {
        this.resolutionDifficulty = resolutionDifficulty;
    }

    public String getExternalId() {
        return externalId;
    }

    public void setExternalId(String externalId) {
        this.externalId = externalId;
    }

    public String getPullRequestUrl() {
        return pullRequestUrl;
    }

    public void setPullRequestUrl(String pullRequestUrl) {
        this.pullRequestUrl = pullRequestUrl;
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

    public Integer getTimeoutCount() {
        return timeoutCount;
    }

    public void setTimeoutCount(Integer timeoutCount) {
        this.timeoutCount = timeoutCount;
    }

    public Integer getHttpGetCount() {
        return httpGetCount;
    }

    public void setHttpGetCount(Integer httpGetCount) {
        this.httpGetCount = httpGetCount;
    }

    public Integer getDbQueryCount() {
        return dbQueryCount;
    }

    public void setDbQueryCount(Integer dbQueryCount) {
        this.dbQueryCount = dbQueryCount;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(Long durationMs) {
        this.durationMs = durationMs;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public void ensureDurationCalculated() {
        if (durationMs != null) {
            return;
        }
        Instant effectiveStart = Objects.requireNonNullElseGet(startedAt, () -> Objects.requireNonNullElse(createdAt, Instant.now()));
        Instant effectiveEnd = Objects.requireNonNullElseGet(finishedAt, Instant::now);
        this.durationMs = Math.max(0L, effectiveEnd.toEpochMilli() - effectiveStart.toEpochMilli());
    }
}
