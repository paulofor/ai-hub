package com.aihub.hub.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CodexQueueRecoveryScheduler {

    private static final Logger log = LoggerFactory.getLogger(CodexQueueRecoveryScheduler.class);

    private final CodexRequestService codexRequestService;

    public CodexQueueRecoveryScheduler(CodexRequestService codexRequestService) {
        this.codexRequestService = codexRequestService;
    }

    @Scheduled(
        initialDelayString = "${hub.codex.queue-recovery.initial-delay-ms:15000}",
        fixedDelayString = "${hub.codex.queue-recovery.fixed-delay-ms:30000}"
    )
    public void recoverQueue() {
        try {
            codexRequestService.recoverQueueAfterRestart();
        } catch (Exception ex) {
            log.error("Falha inesperada ao reconciliar a fila Codex; uma nova tentativa será feita automaticamente", ex);
        }
    }
}
