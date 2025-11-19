package com.aihub.hub.service;

import com.aihub.hub.dto.RepositoryFileView;
import com.aihub.hub.github.GithubApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientResponseException;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

@Service
public class RepositoryFileService {

    private static final Logger log = LoggerFactory.getLogger(RepositoryFileService.class);

    private final GithubApiClient githubApiClient;

    public RepositoryFileService(GithubApiClient githubApiClient) {
        this.githubApiClient = githubApiClient;
    }

    public RepositoryFileView fetchFile(String environment, String path, String ref) {
        RepoCoordinates coordinates = RepoCoordinates.from(environment);
        if (coordinates == null) {
            throw new IllegalArgumentException("Ambiente inválido. Informe no formato owner/repo.");
        }
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("Informe o caminho completo do arquivo no repositório.");
        }

        String branch = (ref == null || ref.isBlank()) ? "main" : ref.trim();
        JsonNode contentNode = loadContent(coordinates, path, branch);
        if (contentNode.isArray()) {
            throw new IllegalArgumentException("O caminho informado é um diretório. Selecione um arquivo específico.");
        }

        String encoding = contentNode.path("encoding").asText(null);
        String rawContent = contentNode.path("content").asText(null);
        String decoded = decodeContent(rawContent, encoding);
        long size = contentNode.path("size").asLong(0);
        String sha = contentNode.path("sha").asText(null);

        return new RepositoryFileView(path, branch, sha, size, decoded);
    }

    private JsonNode loadContent(RepoCoordinates coordinates, String path, String branch) {
        try {
            return githubApiClient.getContent(coordinates.owner(), coordinates.repo(), path, branch);
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == 404) {
                throw new IllegalArgumentException("Arquivo não encontrado no repositório.");
            }
            log.warn("Falha ao buscar arquivo {} em {}/{}: {}", path, coordinates.owner(), coordinates.repo(), ex.getMessage());
            throw new IllegalStateException("Não foi possível obter o arquivo no GitHub: " + ex.getMessage());
        } catch (Exception ex) {
            log.warn("Erro inesperado ao buscar arquivo {} em {}/{}", path, coordinates.owner(), coordinates.repo(), ex);
            throw new IllegalStateException("Erro inesperado ao obter arquivo: " + ex.getMessage());
        }
    }

    private String decodeContent(String rawContent, String encoding) {
        if (rawContent == null) {
            return null;
        }
        if (encoding != null && encoding.equalsIgnoreCase("base64")) {
            byte[] decoded = Base64.getDecoder().decode(rawContent.replaceAll("\\n", ""));
            return new String(decoded, StandardCharsets.UTF_8);
        }
        return rawContent;
    }
}
