package com.aihub.hub.service;

import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.repository.CodexRequestRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SystemMaintenanceService {
    private static final String SANDBOX_CONTAINER = "ai-hub-6-sandbox-orchestrator-1";
    private final RestClient mcp;
    private final SandboxOrchestratorClient sandbox;
    private final CodexRequestRepository requests;
    private final AuditService audit;
    private final AtomicBoolean destructiveActionRunning = new AtomicBoolean(false);
    private final Map<String, Map<String, Object>> idempotentResults = new ConcurrentHashMap<>();

    public SystemMaintenanceService(@Qualifier("mcpRestClient") RestClient mcp,
                                    SandboxOrchestratorClient sandbox,
                                    CodexRequestRepository requests,
                                    AuditService audit) {
        this.mcp = mcp;
        this.sandbox = sandbox;
        this.requests = requests;
        this.audit = audit;
    }

    public Map<String, Object> status() {
        String command = "printf '%s\\n' __DISK__; df -B1 /host | tail -n 1; "
            + "printf '%s\\n' __SERVICES__; docker ps --format '{{.Names}}|{{.Status}}|{{.Image}}'; "
            + "printf '%s\\n' __STATS__; docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.PIDs}}|{{.BlockIO}}'; "
            + "printf '%s\\n' __LOGS__; for id in $(docker ps -aq); do n=$(docker inspect -f '{{.Name}}' $id | sed 's#^/##'); p=$(docker inspect -f '{{.LogPath}}' $id); s=$(stat -c %s /host$p 2>/dev/null || echo 0); echo $n'|'$s; done";
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("generatedAt", Instant.now());
        result.put("host", execute(command));
        try {
            result.put("sandbox", sandbox.maintenanceStatus());
        } catch (RuntimeException ex) {
            result.put("sandbox", Map.of("status", "unavailable", "error", ex.getMessage()));
        }
        result.put("queuedRequests", requests.findAllByOrderByCreatedAtDesc().stream()
            .filter(item -> item.getStatus() == CodexRequestStatus.PENDING)
            .limit(25)
            .map(item -> Map.of("id", item.getId(), "profile", item.getProfile().name(), "createdAt", item.getCreatedAt()))
            .toList());
        result.put("maintenanceBusy", destructiveActionRunning.get());
        return result;
    }

    public Map<String, Object> run(String action, String jobId, String actor, String idempotencyKey) {
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            Map<String, Object> previous = idempotentResults.get(idempotencyKey);
            if (previous != null) return previous;
        }
        if (!destructiveActionRunning.compareAndSet(false, true)) {
            throw new IllegalStateException("Outra ação de manutenção já está em andamento");
        }
        try {
            Object response = switch (action) {
                case "cancel-job" -> requireJobId(jobId, id -> {
                    var responseValue = sandbox.cancelJob(id);
                    return Map.of("job", responseValue == null ? "not-found" : responseValue);
                });
                case "force-cancel-job" -> requireJobId(jobId, sandbox::forceCancelJob);
                case "restart-codex-app-server" -> sandbox.restartCodexAppServer();
                case "restart-sandbox" -> execute("docker restart " + SANDBOX_CONTAINER);
                case "preview-orphan-workspaces" -> execute("docker exec " + SANDBOX_CONTAINER + " sh -lc 'find \"${SANDBOX_WORKDIR:-/tmp}\" -maxdepth 1 -type d -name \"ai-hub-*\" -mmin +120 -printf \"%p|%TY-%Tm-%TdT%TH:%TM|%k KB\\n\" 2>/dev/null | head -100'");
                case "cleanup-orphan-workspaces" -> cleanupOrphanWorkspaces();
                case "preview-old-logs" -> execute("docker exec " + SANDBOX_CONTAINER + " sh -lc \"find /var/lib/ai-hub/codex -type f -mtime +7 -printf '%p|%s\\n' 2>/dev/null | head -100\"");
                case "cleanup-old-logs" -> execute("docker exec " + SANDBOX_CONTAINER + " sh -lc \"find /var/lib/ai-hub/codex -type f -mtime +7 ! -name '*.sqlite' -print -delete 2>/dev/null\"");
                case "cleanup-docker-orphans" -> execute("docker container prune -f --filter label=com.docker.compose.project=ai-hub-6 --filter until=24h; docker network prune -f --filter label=com.docker.compose.project=ai-hub-6 --filter until=24h; docker builder prune -f --filter until=168h");
                default -> throw new IllegalArgumentException("Ação de manutenção não permitida");
            };
            Map<String, Object> payload = Map.of("action", action, "jobId", jobId == null ? "" : jobId, "result", response, "completedAt", Instant.now());
            audit.record(actor, "system_maintenance_" + action, "system", payload);
            if (idempotencyKey != null && !idempotencyKey.isBlank()) idempotentResults.put(idempotencyKey, payload);
            return payload;
        } finally {
            destructiveActionRunning.set(false);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> cleanupOrphanWorkspaces() {
        Map<String, Object> state = sandbox.maintenanceStatus();
        Object active = state.get("activeJobs");
        if (active instanceof List<?> jobs && !jobs.isEmpty()) {
            throw new IllegalStateException("A limpeza de workspaces foi bloqueada porque há jobs ativos");
        }
        return execute("docker exec " + SANDBOX_CONTAINER + " sh -lc 'find \"${SANDBOX_WORKDIR:-/tmp}\" -maxdepth 1 -type d -name \"ai-hub-*\" -mmin +120 -print -exec rm -rf -- {} +'");
    }

    private Object requireJobId(String jobId, java.util.function.Function<String, Map<String, Object>> operation) {
        if (jobId == null || jobId.isBlank()) throw new IllegalArgumentException("jobId é obrigatório");
        return operation.apply(jobId.trim());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> execute(String command) {
        Map<String, Object> response = mcp.post().uri("/tools/linux-command")
            .contentType(MediaType.APPLICATION_JSON).body(Map.of("command", command))
            .retrieve().body(Map.class);
        return response == null ? Map.of("exitCode", -1, "stderr", "Resposta vazia do MCP") : response;
    }
}
