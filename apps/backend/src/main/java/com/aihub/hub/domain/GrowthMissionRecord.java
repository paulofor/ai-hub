package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "growth_missions")
public class GrowthMissionRecord {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 150)
    private String product;

    @Column(nullable = false, length = 500)
    private String objective;

    @Column(name = "target_sales", nullable = false)
    private Integer targetSales;

    @Column(name = "budget_limit", nullable = false, precision = 14, scale = 2)
    private BigDecimal budgetLimit;

    @Column(name = "ends_at")
    private LocalDate endsAt;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false) private Long visitors;
    @Column(name = "cta_clicks", nullable = false) private Long ctaClicks;
    @Column(name = "checkouts_started", nullable = false) private Long checkoutsStarted;
    @Column(name = "sales_approved", nullable = false) private Long salesApproved;
    @Column(name = "briefings_completed", nullable = false) private Long briefingsCompleted;
    @Column(name = "deliveries_completed", nullable = false) private Long deliveriesCompleted;
    @Column(nullable = false) private Long refunds;
    @Column(nullable = false, precision = 14, scale = 2) private BigDecimal revenue;
    @Column(nullable = false, precision = 14, scale = 2) private BigDecimal spend;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public GrowthMissionRecord() {
    }

    @PrePersist
    public void onInsert() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    public void onUpdate() {
        updatedAt = Instant.now();
    }

    public Long getId() { return id; }
    public String getProduct() { return product; }
    public void setProduct(String product) { this.product = product; }
    public String getObjective() { return objective; }
    public void setObjective(String objective) { this.objective = objective; }
    public Integer getTargetSales() { return targetSales; }
    public void setTargetSales(Integer targetSales) { this.targetSales = targetSales; }
    public BigDecimal getBudgetLimit() { return budgetLimit; }
    public void setBudgetLimit(BigDecimal budgetLimit) { this.budgetLimit = budgetLimit; }
    public LocalDate getEndsAt() { return endsAt; }
    public void setEndsAt(LocalDate endsAt) { this.endsAt = endsAt; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getVisitors() { return visitors; }
    public void setVisitors(Long visitors) { this.visitors = visitors; }
    public Long getCtaClicks() { return ctaClicks; }
    public void setCtaClicks(Long ctaClicks) { this.ctaClicks = ctaClicks; }
    public Long getCheckoutsStarted() { return checkoutsStarted; }
    public void setCheckoutsStarted(Long checkoutsStarted) { this.checkoutsStarted = checkoutsStarted; }
    public Long getSalesApproved() { return salesApproved; }
    public void setSalesApproved(Long salesApproved) { this.salesApproved = salesApproved; }
    public Long getBriefingsCompleted() { return briefingsCompleted; }
    public void setBriefingsCompleted(Long briefingsCompleted) { this.briefingsCompleted = briefingsCompleted; }
    public Long getDeliveriesCompleted() { return deliveriesCompleted; }
    public void setDeliveriesCompleted(Long deliveriesCompleted) { this.deliveriesCompleted = deliveriesCompleted; }
    public Long getRefunds() { return refunds; }
    public void setRefunds(Long refunds) { this.refunds = refunds; }
    public BigDecimal getRevenue() { return revenue; }
    public void setRevenue(BigDecimal revenue) { this.revenue = revenue; }
    public BigDecimal getSpend() { return spend; }
    public void setSpend(BigDecimal spend) { this.spend = spend; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
