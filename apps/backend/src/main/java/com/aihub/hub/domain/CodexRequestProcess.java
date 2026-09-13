package com.aihub.hub.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "codex_request_processes")
public class CodexRequestProcess {
    @Id
    @Column(name = "request_id")
    private Long requestId;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId
    @JoinColumn(name = "request_id")
    private CodexRequest request;

    @Column(name = "process_number", nullable = false, length = 80)
    private String processNumber;

    @Column(name = "process_text", nullable = false, length = 500)
    private String processText;

    protected CodexRequestProcess() {}
    public CodexRequestProcess(CodexRequest request) { this.request = request; }
    public String getProcessNumber() { return processNumber; }
    public void setProcessNumber(String processNumber) { this.processNumber = processNumber; }
    public String getProcessText() { return processText; }
    public void setProcessText(String processText) { this.processText = processText; }
}
