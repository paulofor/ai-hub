package com.aihub.mcpserver.controller;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.io.IOException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
        "mcp.server.api-token=test-token",
        "mcp.server.command-timeout-seconds=5",
        "mcp.server.max-output-chars=4096"
})
class PublicProxyRecoveryControllerTest {

    private static final MockWebServer BACKEND = startBackend();

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void backendProperties(DynamicPropertyRegistry registry) {
        registry.add("mcp.server.backend-base-url", () -> BACKEND.url("/").toString());
    }

    @AfterAll
    static void shutdownBackend() throws IOException {
        BACKEND.shutdown();
    }

    @Test
    void forwardsOnlySemanticRecoveryPayloadToFixedBackendRoute() throws Exception {
        UUID requestId = UUID.fromString("13f03b59-67db-4a43-872f-e0294a72270b");
        BACKEND.enqueue(new MockResponse()
                .setResponseCode(202)
                .addHeader("Content-Type", "application/json")
                .setBody("{\"requestId\":\"" + requestId + "\",\"status\":\"DISPATCHED\"}"));

        mockMvc.perform(post("/mcp/tools/recover-public-proxy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "requestId": "13f03b59-67db-4a43-872f-e0294a72270b",
                                  "reason": "Proxy público indisponível após reboot",
                                  "confirmation": "RECOVER_PUBLIC_PROXY"
                                }
                                """))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("DISPATCHED"));

        var recorded = BACKEND.takeRequest();
        assertThat(recorded.getPath()).isEqualTo("/api/internal/operations/public-proxy-recoveries");
        assertThat(recorded.getHeader(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer test-token");
        String body = recorded.getBody().readUtf8();
        assertThat(body).contains(requestId.toString(), "RECOVER_PUBLIC_PROXY");
        assertThat(body).doesNotContain("host", "service", "command", "workflow", "repository");
    }

    @Test
    void preservesCooldownStatusAndRetryAfter() throws Exception {
        BACKEND.enqueue(new MockResponse()
                .setResponseCode(429)
                .addHeader("Content-Type", "application/json")
                .addHeader(HttpHeaders.RETRY_AFTER, "321")
                .setBody("{\"error\":\"cooldown\"}"));

        mockMvc.perform(post("/mcp/tools/recover-public-proxy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "requestId": "29f8086b-e667-42e2-b41c-2156620c96cb",
                                  "reason": "Nova tentativa dentro da janela segura",
                                  "confirmation": "RECOVER_PUBLIC_PROXY"
                                }
                                """))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "321"));

        BACKEND.takeRequest();
    }

    @Test
    void forwardsStatusLookupUsingOnlyTheRequestId() throws Exception {
        UUID requestId = UUID.fromString("ba21b234-7bc0-4507-aae3-62f5f863b182");
        BACKEND.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "application/json")
                .setBody("{\"requestId\":\"" + requestId + "\",\"status\":\"RECOVERED\"}"));

        mockMvc.perform(get("/mcp/tools/recover-public-proxy/{requestId}", requestId)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RECOVERED"));

        var recorded = BACKEND.takeRequest();
        assertThat(recorded.getPath()).isEqualTo(
                "/api/internal/operations/public-proxy-recoveries/" + requestId);
    }

    @Test
    void rejectsUnknownOperationalTargetFieldsBeforeCallingBackend() throws Exception {
        int requestCount = BACKEND.getRequestCount();

        mockMvc.perform(post("/mcp/tools/recover-public-proxy")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "requestId": "88280792-ae51-4a85-bfbb-14f897391554",
                                  "reason": "Tentativa de controlar o alvo",
                                  "confirmation": "RECOVER_PUBLIC_PROXY",
                                  "repository": "outro/repositorio",
                                  "command": "docker restart qualquer-coisa"
                                }
                                """))
                .andExpect(status().isBadRequest());

        assertThat(BACKEND.getRequestCount()).isEqualTo(requestCount);
    }

    private static MockWebServer startBackend() {
        MockWebServer server = new MockWebServer();
        try {
            server.start();
            return server;
        } catch (IOException ex) {
            throw new ExceptionInInitializerError(ex);
        }
    }
}
