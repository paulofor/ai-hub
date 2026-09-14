package com.aihub.hub.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "processes")
public class ProcessRecord {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, unique = true, length = 80)
    private String number;
    @Column(nullable = false, length = 500)
    private String text;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_process_id")
    private ProcessRecord parentProcess;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PrePersist public void onInsert() { createdAt = updatedAt = Instant.now(); }
    @PreUpdate public void onUpdate() { updatedAt = Instant.now(); }
    public Long getId() { return id; }
    public String getNumber() { return number; }
    public void setNumber(String number) { this.number = number; }
    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
    public ProcessRecord getParentProcess() { return parentProcess; }
    public void setParentProcess(ProcessRecord parentProcess) { this.parentProcess = parentProcess; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
