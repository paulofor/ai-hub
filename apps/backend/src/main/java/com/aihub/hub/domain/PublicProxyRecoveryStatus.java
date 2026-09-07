package com.aihub.hub.domain;

public enum PublicProxyRecoveryStatus {
    REQUESTED,
    DISPATCHED,
    QUEUED,
    IN_PROGRESS,
    RECOVERED,
    FAILED,
    DISPATCH_FAILED;

    public boolean isTerminal() {
        return this == RECOVERED || this == FAILED || this == DISPATCH_FAILED;
    }
}
