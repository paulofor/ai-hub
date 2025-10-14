package com.aihub.hub.service;

import com.aihub.hub.domain.PromptRecord;
import com.aihub.hub.domain.ResponseRecord;
import com.aihub.hub.dto.CiFix;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.openai.OpenAIClient;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.repository.ResponseRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class CiAnalysisService {

    private final GithubApiClient githubApiClient;
    private final OpenAIClient openAIClient;
    private final PromptRepository promptRepository;
    private final ResponseRepository responseRepository;
    private final AuditService auditService;
    private final int maxChars;

    public CiAnalysisService(GithubApiClient githubApiClient,
                              OpenAIClient openAIClient,
                              PromptRepository promptRepository,
                              ResponseRepository responseRepository,
                              AuditService auditService,
                              @Value("${hub.logs.max-chars:20000}") int maxChars) {
        this.githubApiClient = githubApiClient;
        this.openAIClient = openAIClient;
        this.promptRepository = promptRepository;
        this.responseRepository = responseRepository;
        this.auditService = auditService;
        this.maxChars = maxChars;
    }

    public ResponseRecord analyze(String actor, String owner, String repo, long runId, Integer prNumber) {
        byte[] zip = githubApiClient.downloadRunLogs(owner, repo, runId);
        String logs = sanitizeLogs(extractLogs(zip));
        if (logs.length() > maxChars) {
            logs = logs.substring(0, maxChars) + "\n...[truncado]";
        }
        String promptText = buildPrompt(repo, runId, prNumber, logs);
        PromptRecord prompt = promptRepository.save(new PromptRecord(owner + "/" + repo, runId, prNumber, openAIClient.getModel(), promptText));
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("repo", owner + "/" + repo);
        metadata.put("run_id", runId);
        if (prNumber != null) {
            metadata.put("pr_number", prNumber);
        }
        CiFix fix = openAIClient.analyzeLogs(promptText, metadata);
        ResponseRecord response = new ResponseRecord(prompt, owner + "/" + repo, runId, prNumber);
        response.setRootCause(fix.getRootCause());
        response.setFixPlan(fix.getFixPlan());
        response.setUnifiedDiff(fix.getUnifiedDiff());
        response.setConfidence(fix.getConfidence());
        response.setRawResponse(null);
        responseRepository.save(response);
        auditService.record(actor, "analyze_run", owner + "/" + repo, metadata);
        return response;
    }

    private String buildPrompt(String repo, long runId, Integer prNumber, String logs) {
        StringBuilder builder = new StringBuilder();
        builder.append("Analise a execução do workflow do repositório ").append(repo)
            .append(" run ").append(runId);
        if (prNumber != null) {
            builder.append(" associado ao PR #").append(prNumber);
        }
        builder.append(". Responda no schema solicitado.\nLogs:\n").append(logs);
        return builder.toString();
    }

    private String sanitizeLogs(String rawLogs) {
        return rawLogs
            .replaceAll("ghs_[A-Za-z0-9]+", "[REDACTED_TOKEN]")
            .replaceAll("gho_[A-Za-z0-9]+", "[REDACTED_TOKEN]")
            .replaceAll("AKIA[0-9A-Z]{16}", "[REDACTED_AWS]");
    }

    private String extractLogs(byte[] zip) {
        StringBuilder builder = new StringBuilder();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (builder.length() > maxChars) {
                    break;
                }
                builder.append("===== ").append(entry.getName()).append(" =====\n");
                builder.append(readEntry(zis));
                builder.append("\n");
            }
        } catch (IOException e) {
            throw new IllegalStateException("Falha ao ler logs de workflow", e);
        }
        return builder.toString();
    }

    private String readEntry(ZipInputStream zis) throws IOException {
        StringBuilder builder = new StringBuilder();
        byte[] buffer = new byte[4096];
        int len;
        while ((len = zis.read(buffer)) > 0) {
            builder.append(new String(buffer, 0, len, StandardCharsets.UTF_8));
            if (builder.length() > maxChars) {
                break;
            }
        }
        return builder.toString();
    }
}
