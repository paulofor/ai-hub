package com.aihub.hub.service;

import com.aihub.hub.github.GithubApiClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SourceModuleChangeServiceTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-10T00:00:00Z"), ZoneOffset.UTC);
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @TempDir
    Path tempDir;

    @Test
    void returnsNullChangeDataWhenModuleHasNoGithubCommitOrLocalDirectory() {
        SourceModuleChangeService service = new SourceModuleChangeService(
            CLOCK,
            mock(GithubApiClient.class),
            "",
            "",
            "main",
            tempDir.toString()
        );

        var modules = service.listModuleChanges();

        assertThat(modules).allSatisfy(module -> {
            assertThat(module.lastChangedAt()).isNull();
            assertThat(module.daysSinceLastChange()).isNull();
        });
    }

    @Test
    void usesGithubCommitDateWhenRepositoryCoordinatesAreConfigured() throws Exception {
        GithubApiClient githubApiClient = mock(GithubApiClient.class);
        when(githubApiClient.listCommits(eq("owner"), eq("repo"), eq("main"), eq("apps/backend"), eq(1)))
            .thenReturn(OBJECT_MAPPER.readTree("""
                [{
                  "commit": {
                    "committer": {
                      "date": "2026-07-07T00:00:00Z"
                    }
                  }
                }]
                """));

        SourceModuleChangeService service = new SourceModuleChangeService(
            CLOCK,
            githubApiClient,
            "owner",
            "repo",
            "main",
            tempDir.toString()
        );

        var backend = service.listModuleChanges().stream()
            .filter(module -> module.path().equals("apps/backend"))
            .findFirst()
            .orElseThrow();

        assertThat(backend.lastChangedAt()).isEqualTo(Instant.parse("2026-07-07T00:00:00Z"));
        assertThat(backend.daysSinceLastChange()).isEqualTo(3);
    }

    @Test
    void usesLatestLocalFileDateWhenGitHistoryIsUnavailable() throws Exception {
        Path moduleDir = tempDir.resolve("apps/frontend/src");
        Files.createDirectories(moduleDir);
        Path file = moduleDir.resolve("main.tsx");
        Files.writeString(file, "console.log('ok');");
        Files.setLastModifiedTime(file, java.nio.file.attribute.FileTime.from(Instant.parse("2026-07-09T00:00:00Z")));

        SourceModuleChangeService service = new SourceModuleChangeService(
            CLOCK,
            mock(GithubApiClient.class),
            "",
            "",
            "main",
            tempDir.toString()
        );

        var frontend = service.listModuleChanges().stream()
            .filter(module -> module.path().equals("apps/frontend"))
            .findFirst()
            .orElseThrow();

        assertThat(frontend.lastChangedAt()).isEqualTo(Instant.parse("2026-07-09T00:00:00Z"));
        assertThat(frontend.daysSinceLastChange()).isEqualTo(1);
    }
}
