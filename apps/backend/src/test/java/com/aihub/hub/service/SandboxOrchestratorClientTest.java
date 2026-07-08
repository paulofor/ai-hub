package com.aihub.hub.service;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SandboxOrchestratorClientTest {

    @Test
    void readCodexAccountReturnsUpstreamUnavailableBodyInsteadOfThrowing() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse()
                .setResponseCode(503)
                .setHeader("Content-Type", "application/json")
                .setBody("{\"connected\":false,\"status\":\"unavailable\",\"executable\":false,\"blockReason\":\"CODEX_APP_SERVER_UNAVAILABLE\"}"));
            SandboxOrchestratorClient client = clientFor(server);

            Map<String, Object> response = client.readCodexAccount();

            assertThat(response).containsEntry("status", "unavailable");
            assertThat(response).containsEntry("blockReason", "CODEX_APP_SERVER_UNAVAILABLE");
        }
    }

    @Test
    void startCodexLoginReturnsUpstreamFailureBodyInsteadOfThrowing() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse()
                .setResponseCode(503)
                .setHeader("Content-Type", "application/json")
                .setBody("{\"status\":\"failed\",\"blockReason\":\"CODEX_APP_SERVER_UNAVAILABLE\"}"));
            SandboxOrchestratorClient client = clientFor(server);

            Map<String, Object> response = client.startCodexLogin("chatgptDeviceCode");

            assertThat(response).containsEntry("status", "failed");
            assertThat(response).containsEntry("blockReason", "CODEX_APP_SERVER_UNAVAILABLE");
        }
    }


    @Test
    void getJobUsesLargestInteractionCounterWhenExplicitCountIsStaleZero() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""
                    {
                      "jobId": "job-stale-count",
                      "status": "COMPLETED",
                      "interactionCount": 0,
                      "interactionSequence": 2,
                      "interactions": [
                        {"id": "job-stale-count-0001-outbound", "direction": "OUTBOUND", "content": "thread/start", "sequence": 1},
                        {"id": "job-stale-count-0002-outbound", "direction": "OUTBOUND", "content": "turn/start", "sequence": 2}
                      ]
                    }
                    """));
            SandboxOrchestratorClient client = clientFor(server);

            SandboxOrchestratorClient.SandboxOrchestratorJobResponse response = client.getJob("job-stale-count");

            assertThat(response.interactionCount()).isEqualTo(2);
        }
    }

    private SandboxOrchestratorClient clientFor(MockWebServer server) {
        RestClient restClient = RestClient.builder()
            .requestFactory(new JdkClientHttpRequestFactory())
            .baseUrl(server.url("/").toString())
            .build();
        return new SandboxOrchestratorClient(restClient, "/jobs");
    }
}
