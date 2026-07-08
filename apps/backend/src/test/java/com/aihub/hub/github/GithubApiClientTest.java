package com.aihub.hub.github;

import com.fasterxml.jackson.databind.JsonNode;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThat;

class GithubApiClientTest {

    private MockWebServer server;
    private GithubApiClient client;

    @BeforeEach
    void setup() throws IOException {
        server = new MockWebServer();
        server.start();
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    void uploadsFileContentToRepository() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"content\":{\"sha\":\"abc\"}}").addHeader("Content-Type", "application/json"));
        RestClient restClient = RestClient.builder().baseUrl(server.url("/").toString()).build();
        GithubAppAuth auth = new GithubAppAuth(restClient, Clock.systemUTC(), "1", GithubAppAuthTest.TEST_KEY, "", "1") {
            @Override
            public String getInstallationToken() {
                return "token";
            }
        };
        client = new GithubApiClient(restClient, auth);
        JsonNode response = client.uploadContent("owner", "repo", "README.md", "Init", "Hello", "main", null);
        assertThat(response.at("/content/sha").asText()).isEqualTo("abc");
        var recorded = server.takeRequest();
        assertThat(recorded.getMethod()).isEqualTo("PUT");
        assertThat(recorded.getPath()).isEqualTo("/repos/owner/repo/contents/README.md");
        assertThat(recorded.getHeader("Authorization")).isEqualTo("Bearer token");
        assertThat(recorded.getBody().readUtf8()).contains("SGVsbG8=");
    }

    @Test
    void deletesBranchRefWithSlashSeparatedName() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(204));
        RestClient restClient = RestClient.builder().baseUrl(server.url("/").toString()).build();
        GithubAppAuth auth = new GithubAppAuth(restClient, Clock.systemUTC(), "1", GithubAppAuthTest.TEST_KEY, "", "1") {
            @Override
            public String getInstallationToken() {
                return "token";
            }
        };
        client = new GithubApiClient(restClient, auth);

        client.deleteBranch("owner", "repo", "ai-hub/codex-owner-repo-main-chatgpt_codex_mkt");

        var recorded = server.takeRequest();
        assertThat(recorded.getMethod()).isEqualTo("DELETE");
        assertThat(recorded.getPath()).isEqualTo("/repos/owner/repo/git/refs/heads/ai-hub/codex-owner-repo-main-chatgpt_codex_mkt");
        assertThat(recorded.getHeader("Authorization")).isEqualTo("Bearer token");
    }

    @Test
    void comparesBaseBranchWithSlashSeparatedWorkBranch() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"files\":[{\"filename\":\"src/App.tsx\"}]}").addHeader("Content-Type", "application/json"));
        RestClient restClient = RestClient.builder().baseUrl(server.url("/").toString()).build();
        GithubAppAuth auth = new GithubAppAuth(restClient, Clock.systemUTC(), "1", GithubAppAuthTest.TEST_KEY, "", "1") {
            @Override
            public String getInstallationToken() {
                return "token";
            }
        };
        client = new GithubApiClient(restClient, auth);

        JsonNode response = client.compare("owner", "repo", "main", "ai-hub/codex-owner-repo-main-chatgpt_codex_mkt");

        assertThat(response.at("/files/0/filename").asText()).isEqualTo("src/App.tsx");
        var recorded = server.takeRequest();
        assertThat(recorded.getMethod()).isEqualTo("GET");
        assertThat(recorded.getPath()).isEqualTo("/repos/owner/repo/compare/main...ai-hub%2Fcodex-owner-repo-main-chatgpt_codex_mkt");
        assertThat(recorded.getHeader("Authorization")).isEqualTo("Bearer token");
    }
}
