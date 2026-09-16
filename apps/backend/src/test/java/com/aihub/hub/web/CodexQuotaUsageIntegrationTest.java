package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:quota-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "hub.sandbox.callback.secret=synthetic-quota-callback", "hub.codex.app-server-enabled=false"
})
class CodexQuotaUsageIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private CodexRequestRepository repository;
    @MockBean private SandboxOrchestratorClient sandboxClient;
    @MockBean private GithubApiClient githubClient;
    private final List<Long> ids = new ArrayList<>();
    @AfterEach void cleanup() { repository.deleteAllById(ids); }

    @Test void persistsCallbackAndReturnsSameMeasurementInDetailAndPaginatedHistory() throws Exception {
        String input = System.getenv("QUOTA_E2E_PAYLOAD");
        ObjectNode payload = input == null ? (ObjectNode) mapper.readTree("""
            {"jobId":"quota-test-CHATGPT_CODEX_MKT","status":"COMPLETED","summary":"Validação local",
            "quotaUsage":{"version":1,"status":"estimated","eventsObserved":1,"concurrentObserved":false,
            "start":{"capturedAt":"2026-09-16T12:00:00Z"},"end":{"capturedAt":"2026-09-16T12:01:00Z"},
            "windows":[{"limitId":"codex","window":"secondary","windowDurationMins":10080,"resetsAt":2000000000,
            "usedPercent":6,"finalUsedPercent":8,"consumedPercentagePoints":2}]}}
            """) : (ObjectNode) mapper.readTree(Files.readString(Path.of(input)));
        String quota = payload.path("quotaUsage").toString();
        CodexRequest request = new CodexRequest("sandbox.local", "gpt-6-astra", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "Teste de cota");
        request.setExternalId(payload.path("jobId").asText()); request.setStatus(CodexRequestStatus.RUNNING); request.setRating(5);
        repository.saveAndFlush(request); ids.add(request.getId());
        CodexRequest other = new CodexRequest("sandbox.local", "gpt-6-astra", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "Legado sem medição");
        other.setStatus(CodexRequestStatus.COMPLETED); repository.saveAndFlush(other); ids.add(other.getId());

        mvc.perform(post("/api/codex/requests/callbacks/sandbox").contentType(MediaType.APPLICATION_JSON).content(payload.toString()))
            .andExpect(status().isUnauthorized());
        callback(payload);
        assertThat(repository.findById(request.getId()).orElseThrow().getQuotaUsage()).isEqualTo(quota);
        assertThat(repository.findById(other.getId()).orElseThrow().getQuotaUsage()).isNull();
        String detail = mvc.perform(get("/api/codex/requests/{id}", request.getId()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quotaUsage").value(quota))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        for (String suffix : new String[] { "", "&rating=5" }) {
            String list = mvc.perform(get("/api/codex/requests?page=0&size=20" + suffix)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            assertThat(mapper.readTree(list).path("content").findValuesAsText("quotaUsage")).contains(quota);
        }
        // Duplicate delivery, absent measurement and delayed baseline must not destroy the final snapshot.
        callback(payload);
        ObjectNode late = mapper.createObjectNode().put("jobId", request.getExternalId()).put("status", "COMPLETED");
        callback(late);
        late.set("quotaUsage", mapper.createObjectNode().put("version", 1).put("status", "measuring"));
        callback(late);
        assertThat(repository.findById(request.getId()).orElseThrow().getQuotaUsage()).isEqualTo(quota);
        String output = System.getenv("QUOTA_E2E_DETAIL");
        if (output != null) Files.writeString(Path.of(output), detail);
    }
    private void callback(ObjectNode payload) throws Exception {
        mvc.perform(post("/api/codex/requests/callbacks/sandbox")
                .header("X-Sandbox-Callback-Token", "synthetic-quota-callback")
                .contentType(MediaType.APPLICATION_JSON).content(payload.toString()))
            .andExpect(status().isAccepted());
    }
}
