package com.aihub.hub.service;

import com.aihub.hub.dto.SourceModuleChangeView;
import com.aihub.hub.github.GithubApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;

@Service
public class SourceModuleChangeService {

    private static final List<SourceModule> MODULES = List.of(
        new SourceModule("Backend", "apps/backend"),
        new SourceModule("Frontend", "apps/frontend"),
        new SourceModule("Sandbox Orchestrator", "apps/sandbox-orchestrator"),
        new SourceModule("MCP Server", "apps/mcp-server")
    );

    private final Clock clock;
    private final GithubApiClient githubApiClient;
    private final Path repositoryRoot;
    private final String githubOwner;
    private final String githubRepo;
    private final String githubBranch;

    public SourceModuleChangeService(
        Clock clock,
        GithubApiClient githubApiClient,
        @Value("${hub.source.repository.owner:${GITHUB_SOURCE_OWNER:}}") String githubOwner,
        @Value("${hub.source.repository.repo:${GITHUB_SOURCE_REPO:}}") String githubRepo,
        @Value("${hub.source.repository.branch:${GITHUB_SOURCE_BRANCH:main}}") String githubBranch
    ) {
        this.clock = clock;
        this.githubApiClient = githubApiClient;
        this.githubOwner = githubOwner;
        this.githubRepo = githubRepo;
        this.githubBranch = githubBranch;
        this.repositoryRoot = discoverRepositoryRoot();
    }

    public List<SourceModuleChangeView> listModuleChanges() {
        return MODULES.stream()
            .map(this::toView)
            .toList();
    }

    private SourceModuleChangeView toView(SourceModule module) {
        Instant lastChangedAt = lastCommitInstant(module.path());
        long daysSinceLastChange = Math.max(0, Duration.between(lastChangedAt, clock.instant()).toDays());
        return new SourceModuleChangeView(module.name(), module.path(), lastChangedAt, daysSinceLastChange);
    }

    private Instant lastCommitInstant(String modulePath) {
        Instant githubInstant = lastCommitInstantFromGithub(modulePath);
        if (githubInstant != null) {
            return githubInstant;
        }
        try {
            Process process = new ProcessBuilder("git", "log", "-1", "--format=%cI", "--", modulePath)
                .directory(repositoryRoot.toFile())
                .redirectErrorStream(true)
                .start();
            byte[] output = process.getInputStream().readAllBytes();
            int exitCode = process.waitFor();
            String text = new String(output, StandardCharsets.UTF_8).trim();
            if (exitCode != 0 || text.isBlank()) {
                return latestFileModifiedAt(modulePath);
            }
            return Instant.parse(text);
        } catch (IOException | InterruptedException | DateTimeParseException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return latestFileModifiedAt(modulePath);
        }
    }

    private Instant lastCommitInstantFromGithub(String modulePath) {
        if (githubOwner.isBlank() || githubRepo.isBlank()) {
            return null;
        }
        try {
            JsonNode commits = githubApiClient.listCommits(githubOwner, githubRepo, githubBranch, modulePath, 1);
            if (commits == null || !commits.isArray() || commits.isEmpty()) {
                return null;
            }
            JsonNode date = commits.get(0).path("commit").path("committer").path("date");
            return date.isTextual() ? Instant.parse(date.asText()) : null;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private Instant latestFileModifiedAt(String modulePath) {
        Path absoluteModulePath = repositoryRoot.resolve(modulePath);
        try (var paths = Files.walk(absoluteModulePath)) {
            return paths
                .filter(Files::isRegularFile)
                .filter(path -> !path.toString().contains("/node_modules/"))
                .filter(path -> !path.toString().contains("/target/"))
                .filter(path -> !path.toString().contains("/dist/"))
                .map(this::lastModifiedAt)
                .max(Instant::compareTo)
                .orElse(Instant.EPOCH);
        } catch (IOException ex) {
            return Instant.EPOCH;
        }
    }

    private Instant lastModifiedAt(Path path) {
        try {
            return Files.getLastModifiedTime(path).toInstant();
        } catch (IOException ex) {
            return Instant.EPOCH;
        }
    }

    private Path discoverRepositoryRoot() {
        Path current = Path.of("").toAbsolutePath();
        while (current != null) {
            if (Files.isDirectory(current.resolve(".git"))) {
                return current;
            }
            current = current.getParent();
        }
        return Path.of("").toAbsolutePath();
    }

    private record SourceModule(String name, String path) {
    }
}
