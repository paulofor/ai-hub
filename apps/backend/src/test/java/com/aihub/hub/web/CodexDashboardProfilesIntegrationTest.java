package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.service.CodexRequestService;
import com.aihub.hub.service.SandboxOrchestratorClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:dashboard-profiles-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "spring.flyway.enabled=true",
    "spring.flyway.locations=classpath:db/migration/h2",
    "spring.jpa.hibernate.ddl-auto=validate",
    "hub.codex.app-server-enabled=false"
})
@Transactional
class CodexDashboardProfilesIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private CodexRequestRepository requests;
    @Autowired private CodexRequestService service;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void globalDashboardAddsTechnicalAndMarketingInWindowsAndChartsWhileMarketingStaysIsolated() throws Exception {
        Clock previous = (Clock) ReflectionTestUtils.getField(service, "dashboardClock");
        Instant now = Instant.now();
        ReflectionTestUtils.setField(service, "dashboardClock", Clock.fixed(now, ZoneId.of("America/Sao_Paulo")));
        try {
            save(CodexIntegrationProfile.CHATGPT_CODEX, now, 3, 2_000, 250, 2);
            save(CodexIntegrationProfile.CHATGPT_CODEX_MKT, now, 2, 1_000, 100, 1);
            CodexRequest pending = new CodexRequest("test/dashboard@main", "gpt-6.1-sol",
                CodexIntegrationProfile.CHATGPT_CODEX, "Pendente sintético sem consumo");
            requests.saveAndFlush(pending);
            var global = mvc.perform(get("/api/codex/requests/metrics")).andExpect(status().isOk());
            for (String window : new String[] { "day", "week", "month" }) {
                global.andExpect(jsonPath("$." + window + ".requestCount").value(2))
                    .andExpect(jsonPath("$." + window + ".interactionCount").value(5))
                    .andExpect(jsonPath("$." + window + ".durationMs").value(3_000))
                    .andExpect(jsonPath("$." + window + ".totalTokens").value(350))
                    .andExpect(jsonPath("$." + window + ".weeklyQuotaConsumedPercentagePoints").value(3.0));
            }
            for (String series : new String[] { "daily", "weekly", "monthly" }) {
                String bucket = "$.series." + series + "[-1]";
                global.andExpect(jsonPath(bucket + ".requestCount").value(2))
                    .andExpect(jsonPath(bucket + ".interactionCount").value(5))
                    .andExpect(jsonPath(bucket + ".durationMs").value(3_000))
                    .andExpect(jsonPath(bucket + ".totalTokens").value(350))
                    .andExpect(jsonPath(bucket + ".weeklyQuotaConsumedPercentagePoints").value(3.0));
            }
            for (String profile : new String[] { "CHATGPT_CODEX", "CHATGPT_CODEX_MKT" }) {
                mvc.perform(get("/api/codex/requests/metrics").param("profile", profile))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.day.requestCount").value(1));
            }
        } finally {
            ReflectionTestUtils.setField(service, "dashboardClock", previous);
        }
    }

    private void save(CodexIntegrationProfile profile, Instant startedAt, int interactions,
                      long duration, int tokens, int quota) {
        CodexRequest request = new CodexRequest("test/dashboard@main", "gpt-6.1-sol", profile, "Fixture local");
        request.setStatus(CodexRequestStatus.COMPLETED);
        request.setStartedAt(startedAt);
        request.setFinishedAt(startedAt.plusSeconds(3));
        request.setInteractionCount(interactions);
        request.setDurationMs(duration);
        request.setTotalTokens(tokens);
        request.setQuotaUsage("""
            {"version":1,"status":"estimated","windows":[{"limitId":"codex","window":"secondary",
             "windowDurationMins":10080,"consumedPercentagePoints":%d}]}
            """.formatted(quota));
        requests.saveAndFlush(request);
    }
}
