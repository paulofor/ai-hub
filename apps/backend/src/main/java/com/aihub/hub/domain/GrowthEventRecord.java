package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "growth_events", uniqueConstraints = @UniqueConstraint(name = "uk_growth_events_source_event", columnNames = {"source", "external_id"}))
public class GrowthEventRecord {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "mission_id", nullable = false) private Long missionId;
    @Column(nullable = false, length = 40) private String type;
    @Column(nullable = false, length = 80) private String source;
    @Column(name = "external_id", nullable = false, length = 190) private String externalId;
    @Column(nullable = false, precision = 14, scale = 2) private BigDecimal amount;
    @Column(name = "occurred_at", nullable = false) private Instant occurredAt;
    @Column(name = "received_at", nullable = false, updatable = false) private Instant receivedAt;

    @PrePersist void onInsert() { receivedAt = Instant.now(); }

    public Long getId() { return id; }
    public Long getMissionId() { return missionId; }
    public void setMissionId(Long missionId) { this.missionId = missionId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getExternalId() { return externalId; }
    public void setExternalId(String externalId) { this.externalId = externalId; }
    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public Instant getOccurredAt() { return occurredAt; }
    public void setOccurredAt(Instant occurredAt) { this.occurredAt = occurredAt; }
    public Instant getReceivedAt() { return receivedAt; }
}
