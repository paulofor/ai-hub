package com.aihub.hub.service;

import com.aihub.hub.domain.CiFixJobRecord;
import com.aihub.hub.domain.Project;
import com.aihub.hub.dto.CiFixJobView;
import com.aihub.hub.dto.CreateCiFixJobRequest;
import com.aihub.hub.repository.CiFixJobRepository;
import com.aihub.hub.repository.ProjectRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CiFixJobServiceTest {

    private final ProjectRepository projectRepository = mock(ProjectRepository.class);
    private final CiFixJobRepository jobRepository = mock(CiFixJobRepository.class);
    private final SandboxOrchestratorClient sandboxOrchestratorClient = mock(SandboxOrchestratorClient.class);
    private final AuditService auditService = mock(AuditService.class);

    @Test
    void createJobPersistsAndPropagatesToOrchestrator() {
        Project project = new Project();
        project.setRepo("owner/repo");
        project.setRepoUrl("https://github.com/owner/repo.git");
        ReflectionTestUtils.setField(project, "id", 42L);
        when(projectRepository.findById(42L)).thenReturn(Optional.of(project));
        when(jobRepository.save(org.mockito.ArgumentMatchers.any(CiFixJobRecord.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        when(sandboxOrchestratorClient.createJob(org.mockito.ArgumentMatchers.any()))
            .thenReturn(new SandboxOrchestratorClient.SandboxOrchestratorJobResponse(
                "job-1",
                "RUNNING",
                "investigating",
                List.of("README.md"),
                "diff --git",
                null
            ));

        CiFixJobService service = new CiFixJobService(projectRepository, jobRepository, sandboxOrchestratorClient, auditService);
        CreateCiFixJobRequest request = new CreateCiFixJobRequest();
        request.setProjectId(42L);
        request.setTaskDescription("look into failure");
        request.setBranch("main");
        request.setCommitHash("abc123");
        request.setTestCommand("mvn test");

        CiFixJobView view = service.createJob("alice", request);

        ArgumentCaptor<CiFixJobRecord> recordCaptor = ArgumentCaptor.forClass(CiFixJobRecord.class);
        verify(jobRepository, org.mockito.Mockito.atLeastOnce()).save(recordCaptor.capture());
        CiFixJobRecord persisted = recordCaptor.getValue();

        assertThat(view.jobId()).isEqualTo(persisted.getJobId());
        assertThat(view.status()).isEqualTo("RUNNING");
        assertThat(view.summary()).isEqualTo("investigating");
        assertThat(view.changedFiles()).containsExactly("README.md");
        assertThat(persisted.getCommitHash()).isEqualTo("abc123");
        assertThat(persisted.getCreatedAt()).isBeforeOrEqualTo(Instant.now());
    }

    @Test
    void refreshJobUsesOrchestratorPayload() {
        CiFixJobRecord record = new CiFixJobRecord();
        record.setJobId("job-refresh");
        record.setStatus("PENDING");
        record.setUpdatedAt(Instant.now());

        when(jobRepository.findByJobId("job-refresh")).thenReturn(Optional.of(record));
        when(jobRepository.save(record)).thenReturn(record);
        when(sandboxOrchestratorClient.getJob("job-refresh"))
            .thenReturn(new SandboxOrchestratorClient.SandboxOrchestratorJobResponse(
                "job-refresh",
                "COMPLETED",
                "done",
                List.of("src/Main.java"),
                "diff --git",
                null
            ));

        CiFixJobService service = new CiFixJobService(projectRepository, jobRepository, sandboxOrchestratorClient, auditService);
        CiFixJobView view = service.refreshFromOrchestrator("job-refresh");

        assertThat(view.status()).isEqualTo("COMPLETED");
        assertThat(view.changedFiles()).containsExactly("src/Main.java");
        assertThat(record.getChangedFiles()).isEqualTo("src/Main.java");
    }
}
