package com.aihub.hub.service;

import com.aihub.hub.domain.SourceRepositoryConfig;
import com.aihub.hub.dto.SourceRepositoryConfigRequest;
import com.aihub.hub.repository.SourceRepositoryConfigRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SourceRepositoryConfigServiceTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-23T03:50:00Z"), ZoneOffset.UTC);

    private final SourceRepositoryConfigRepository repository = mock(SourceRepositoryConfigRepository.class);
    private final SourceRepositoryConfigService service = new SourceRepositoryConfigService(repository, CLOCK);

    @Test
    void emptyConfigViewUsesAiHubRepositoryDefaults() {
        when(repository.findById(1L)).thenReturn(Optional.empty());

        var view = service.getConfigView();

        assertThat(view.owner()).isEqualTo("paulofor");
        assertThat(view.repo()).isEqualTo("ai-hub");
        assertThat(view.branch()).isEqualTo("main");
        assertThat(view.tokenConfigured()).isFalse();
        assertThat(view.updatedAt()).isNull();
    }

    @Test
    void saveConfigAlwaysUsesAiHubRepositoryDefaults() {
        when(repository.findById(1L)).thenReturn(Optional.empty());
        when(repository.save(any(SourceRepositoryConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var view = service.saveConfig(new SourceRepositoryConfigRequest(
            "wrong-owner",
            "wrong-repo",
            "develop",
            "github_pat_secret"
        ));

        ArgumentCaptor<SourceRepositoryConfig> captor = ArgumentCaptor.forClass(SourceRepositoryConfig.class);
        verify(repository).save(captor.capture());
        SourceRepositoryConfig saved = captor.getValue();

        assertThat(saved.getGithubOwner()).isEqualTo("paulofor");
        assertThat(saved.getGithubRepo()).isEqualTo("ai-hub");
        assertThat(saved.getGithubBranch()).isEqualTo("main");
        assertThat(saved.getGithubToken()).isEqualTo("github_pat_secret");
        assertThat(saved.getUpdatedAt()).isEqualTo(CLOCK.instant());
        assertThat(view.owner()).isEqualTo("paulofor");
        assertThat(view.repo()).isEqualTo("ai-hub");
        assertThat(view.branch()).isEqualTo("main");
    }

    @Test
    void saveConfigWithoutTokenStillRequiresExistingToken() {
        when(repository.findById(1L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.saveConfig(new SourceRepositoryConfigRequest(null, null, null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("token do GitHub");
    }
}
