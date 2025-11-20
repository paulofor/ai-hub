package com.aihub.hub.service;

import com.aihub.hub.domain.CiFixJobRecord;
import com.aihub.hub.domain.Project;
import com.aihub.hub.dto.CiFixJobView;
import com.aihub.hub.dto.CreateCiFixJobRequest;
import com.aihub.hub.repository.CiFixJobRepository;
import com.aihub.hub.repository.ProjectRepository;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Service
public class CiFixJobService {

    private final ProjectRepository projectRepository;
    private final CiFixJobRepository jobRepository;
    private final SandboxProvisioningService sandboxProvisioningService;
    private final AuditService auditService;

    public CiFixJobService(ProjectRepository projectRepository,
                           CiFixJobRepository jobRepository,
                           SandboxProvisioningService sandboxProvisioningService,
                           AuditService auditService) {
        this.projectRepository = projectRepository;
        this.jobRepository = jobRepository;
        this.sandboxProvisioningService = sandboxProvisioningService;
        this.auditService = auditService;
    }

    @Transactional
    public CiFixJobView createJob(String actor, CreateCiFixJobRequest request) {
        Project project = projectRepository.findById(request.getProjectId())
            .orElseThrow(() -> new IllegalArgumentException("Projeto não encontrado"));
        if (project.getRepoUrl() == null || project.getRepoUrl().isBlank()) {
            throw new IllegalStateException("Project.repoUrl não configurado para o projeto solicitado");
        }

        String branch = request.getBranch() != null && !request.getBranch().isBlank()
            ? request.getBranch().trim()
            : "main";

        CiFixJobRecord record = new CiFixJobRecord();
        record.setJobId(UUID.randomUUID().toString());
        record.setProject(project);
        record.setBranch(branch);
        record.setCommitHash(request.getCommitHash());
        record.setTaskDescription(request.getTaskDescription());
        record.setTestCommand(request.getTestCommand());
        record.setStatus("QUEUED");
        record.setUpdatedAt(Instant.now());
        jobRepository.save(record);

        SandboxJobRequest jobRequest = new SandboxJobRequest(
            record.getJobId(),
            project.getRepoUrl(),
            branch,
            request.getTaskDescription(),
            project.getRepo(),
            null,
            request.getTestCommand()
        );

        JsonNode orchestratorResponse = sandboxProvisioningService.submitJob(jobRequest);
        if (orchestratorResponse != null) {
            populateFromOrchestrator(record, orchestratorResponse);
            jobRepository.save(record);
        }

        auditService.record(actor, "cifix_job_created", project.getRepo(), null);
        return CiFixJobView.from(record);
    }

    @Transactional(readOnly = true)
    public CiFixJobView getJob(String jobId) {
        CiFixJobRecord record = jobRepository.findByJobId(jobId)
            .orElseThrow(() -> new IllegalArgumentException("Job não encontrado"));
        return CiFixJobView.from(record);
    }

    @Transactional
    public CiFixJobView refreshFromOrchestrator(String jobId) {
        CiFixJobRecord record = jobRepository.findByJobId(jobId)
            .orElseThrow(() -> new IllegalArgumentException("Job não encontrado"));

        JsonNode orchestratorResponse = sandboxProvisioningService.fetchJob(jobId);
        if (orchestratorResponse != null) {
            populateFromOrchestrator(record, orchestratorResponse);
            record.setUpdatedAt(Instant.now());
            jobRepository.save(record);
        }
        return CiFixJobView.from(record);
    }

    private void populateFromOrchestrator(CiFixJobRecord record, JsonNode payload) {
        Optional.ofNullable(payload.path("status").asText(null)).ifPresent(record::setStatus);
        Optional.ofNullable(payload.path("summary").asText(null)).ifPresent(record::setSummary);
        Optional.ofNullable(payload.path("patch").asText(null)).ifPresent(record::setPatch);
        JsonNode changedFilesNode = payload.path("changedFiles");
        if (changedFilesNode != null && changedFilesNode.isArray() && !changedFilesNode.isEmpty()) {
            StringBuilder builder = new StringBuilder();
            for (JsonNode fileNode : changedFilesNode) {
                if (fileNode == null || fileNode.isMissingNode() || fileNode.isNull()) {
                    continue;
                }
                String value = fileNode.asText(null);
                if (value != null && !value.isBlank()) {
                    if (builder.length() > 0) {
                        builder.append("\n");
                    }
                    builder.append(value.trim());
                }
            }
            record.setChangedFiles(builder.length() > 0 ? builder.toString() : null);
        }
    }
}
