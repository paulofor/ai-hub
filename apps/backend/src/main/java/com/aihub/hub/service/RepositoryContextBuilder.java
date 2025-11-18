package com.aihub.hub.service;

import com.aihub.hub.github.GithubApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

@Component
public class RepositoryContextBuilder {

    private static final Logger log = LoggerFactory.getLogger(RepositoryContextBuilder.class);
    private static final int MAX_TREE_ENTRIES = 50;

    private final GithubApiClient githubApiClient;

    public RepositoryContextBuilder(GithubApiClient githubApiClient) {
        this.githubApiClient = githubApiClient;
    }

    public String build(String environment) {
        RepoCoordinates coordinates = RepoCoordinates.from(environment);
        if (coordinates == null) {
            return null;
        }

        String stage = "metadados do repositório";
        try {
            log.info("Iniciando montagem do contexto do repositório {} na etapa: {}", environment, stage);
            JsonNode repository = githubApiClient.getRepository(coordinates.owner(), coordinates.repo());
            String defaultBranch = repository.path("default_branch").asText("main");
            String description = repository.path("description").asText("");

            StringBuilder builder = new StringBuilder();
            builder.append(coordinates.owner()).append("/").append(coordinates.repo());
            builder.append("\nBranch padrão: ").append(defaultBranch);
            if (description != null && !description.isBlank()) {
                builder.append("\nDescrição: ").append(description.trim());
            }

            stage = "árvore de arquivos";
            appendTreeSummary(builder, coordinates, defaultBranch);
            stage = "README";
            appendReadmeExcerpt(builder, coordinates, defaultBranch);

            return builder.toString();
        } catch (Exception ex) {
            log.info("Não foi possível montar contexto do repositório {} na etapa {}: {}", environment, stage, ex.getMessage());
            return null;
        }
    }

    private void appendTreeSummary(StringBuilder builder, RepoCoordinates coordinates, String branch) {
        try {
            log.info("Buscando árvore do repositório {}/{} na branch {}", coordinates.owner(), coordinates.repo(), branch);
            JsonNode branchData = githubApiClient.getBranch(coordinates.owner(), coordinates.repo(), branch);
            String baseSha = branchData.path("object").path("sha").asText(null);
            if (baseSha == null || baseSha.isBlank()) {
                return;
            }

            JsonNode tree = githubApiClient.getTree(coordinates.owner(), coordinates.repo(), baseSha, true);
            JsonNode items = tree.path("tree");
            if (items == null || !items.isArray() || items.isEmpty()) {
                return;
            }

            String treeSummary = StreamSupport.stream(items.spliterator(), false)
                .limit(MAX_TREE_ENTRIES)
                .map(node -> node.path("path").asText(null))
                .filter(path -> path != null && !path.isBlank())
                .collect(Collectors.joining("\n"));

            if (!treeSummary.isBlank()) {
                builder.append("\nArquivos (limite ").append(MAX_TREE_ENTRIES).append("):\n");
                builder.append(treeSummary);
            }
        } catch (Exception ex) {
            log.info("Falha ao obter árvore do repositório {}: {}", coordinates, ex.getMessage());
        }
    }

    private void appendReadmeExcerpt(StringBuilder builder, RepoCoordinates coordinates, String branch) {
        try {
            log.info("Buscando README do repositório {}/{} na branch {}", coordinates.owner(), coordinates.repo(), branch);
            JsonNode readme = githubApiClient.getContent(coordinates.owner(), coordinates.repo(), "README.md", branch);
            String encoded = readme.path("content").asText(null);
            if (encoded == null || encoded.isBlank()) {
                return;
            }
            String content = new String(Base64.getDecoder().decode(encoded.replaceAll("\\n", "")), StandardCharsets.UTF_8);
            String trimmed = content.strip();
            if (trimmed.isEmpty()) {
                return;
            }
            String excerpt = trimmed.length() > 600 ? trimmed.substring(0, 600) + "..." : trimmed;
            builder.append("\n\nTrecho do README:\n").append(excerpt);
        } catch (Exception ex) {
            log.info("Falha ao obter README para {}/{}: {}", coordinates.owner(), coordinates.repo(), ex.getMessage());
        }
    }

    private record RepoCoordinates(String owner, String repo) {
        static RepoCoordinates from(String environment) {
            if (environment == null || environment.isBlank()) {
                return null;
            }
            String[] parts = environment.trim().split("/");
            if (parts.length < 2) {
                return null;
            }
            return new RepoCoordinates(parts[0], parts[1]);
        }
    }
}
