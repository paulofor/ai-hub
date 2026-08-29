package com.aihub.hub.service;

public class PublicProxyRecoveryCooldownException extends RuntimeException {

    private final long retryAfterSeconds;

    public PublicProxyRecoveryCooldownException(long retryAfterSeconds) {
        super("A recuperação do proxy está em cooldown");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
