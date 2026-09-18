package com.aihub.hub.service;

import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.PullRequestExplanationRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PullRequestServiceTest {

    private final GithubApiClient githubApiClient = mock(GithubApiClient.class);
    private final PullRequestService service = new PullRequestService(
        githubApiClient,
        mock(UnifiedDiffApplier.class),
        mock(AuditService.class),
        mock(PullRequestExplanationRepository.class)
    );
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void treatsBranchWithoutCommitsAheadAsNotPublishableEvenWhenComparisonListsFiles() {
        when(githubApiClient.compare("owner", "repo", "main", "work"))
            .thenReturn(objectMapper.createObjectNode()
                .put("ahead_by", 0)
                .set("files", objectMapper.createArrayNode()
                    .add(objectMapper.createObjectNode().put("filename", "src/App.java"))));

        PullRequestService.BranchPublicationReadiness readiness =
            service.inspectBranchPublicationReadiness("owner", "repo", "main", "work");

        assertThat(readiness.hasAnyDiff()).isFalse();
        assertThat(readiness.hasFunctionalDiff()).isFalse();
    }

    @Test
    void rejectsComparisonWithoutAheadCountInsteadOfAttemptingAnInvalidPullRequest() {
        when(githubApiClient.compare("owner", "repo", "main", "work"))
            .thenReturn(objectMapper.createObjectNode()
                .set("files", objectMapper.createArrayNode()));

        assertThatThrownBy(() -> service.inspectBranchPublicationReadiness("owner", "repo", "main", "work"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Resposta inválida ao comparar branches para publicação");
    }
}
