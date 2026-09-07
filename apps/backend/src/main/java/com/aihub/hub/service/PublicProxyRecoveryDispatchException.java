package com.aihub.hub.service;

import java.util.UUID;

public class PublicProxyRecoveryDispatchException extends RuntimeException {

    private final UUID requestId;

    public PublicProxyRecoveryDispatchException(UUID requestId, Throwable cause) {
        super("O GitHub não aceitou a operação de recuperação", cause);
        this.requestId = requestId;
    }

    public UUID getRequestId() {
        return requestId;
    }
}
