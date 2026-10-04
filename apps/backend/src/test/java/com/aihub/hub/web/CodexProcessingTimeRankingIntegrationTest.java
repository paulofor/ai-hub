package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:processing-time-ranking-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "spring.flyway.enabled=true",
    "spring.flyway.locations=classpath:db/migration/h2",
    "spring.jpa.hibernate.ddl-auto=validate",
    "hub.codex.app-server-enabled=false",
    "hub.codex.queue-recovery.initial-delay-ms=3600000"
})
@Transactional
class CodexProcessingTimeRankingIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private CodexRequestRepository requests;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void returnsStoredTokensWithTitlesAndKeepsDurationOrdering() throws Exception {
        CodexRequest slow = save(7_200_000L, 12_345, CodexRequestStatus.COMPLETED);
        slow.setResponseText("{\"titulo\":\"Processar lote extenso\",\"comentario\":\"Detalhe privado\"}");
        requests.saveAndFlush(slow);
        CodexRequest fast = save(90_000L, 9_000_000, CodexRequestStatus.FAILED);

        mvc.perform(get("/api/codex/requests/processing-time-ranking"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(slow.getId()))
            .andExpect(jsonPath("$[0].durationMs").value(7_200_000))
            .andExpect(jsonPath("$[0].totalTokens").value(12_345))
            .andExpect(jsonPath("$[0].requestTitle").value("Processar lote extenso"))
            .andExpect(jsonPath("$[0].prompt").doesNotExist())
            .andExpect(jsonPath("$[0].responseText").doesNotExist())
            .andExpect(jsonPath("$[1].id").value(fast.getId()))
            .andExpect(jsonPath("$[1].status").value("FAILED"))
            .andExpect(jsonPath("$[1].totalTokens").value(9_000_000));
    }

    @Test
    void preservesZeroAndMissingUsageWithoutExcludingTimedRequests() throws Exception {
        CodexRequest missing = save(2_000L, null, CodexRequestStatus.COMPLETED);
        CodexRequest zero = save(1_000L, 0, CodexRequestStatus.CANCELLED);
        save(null, 100_000, CodexRequestStatus.PENDING);

        mvc.perform(get("/api/codex/requests/processing-time-ranking"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(missing.getId()))
            .andExpect(jsonPath("$[0].totalTokens").value(nullValue()))
            .andExpect(jsonPath("$[1].id").value(zero.getId()))
            .andExpect(jsonPath("$[1].totalTokens").value(0));
    }

    @Test
    void keepsTopTwentyLimitAndNewestIdAsDurationTieBreaker() throws Exception {
        CodexRequest newest = null;
        for (int index = 0; index < 22; index++) {
            newest = save(1_000L, index, CodexRequestStatus.COMPLETED);
        }

        mvc.perform(get("/api/codex/requests/processing-time-ranking"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(20))
            .andExpect(jsonPath("$[0].id").value(newest.getId()))
            .andExpect(jsonPath("$[0].totalTokens").value(21))
            .andExpect(jsonPath("$[19].totalTokens").value(2));
    }

    private CodexRequest save(Long durationMs, Integer totalTokens, CodexRequestStatus status) {
        CodexRequest request = new CodexRequest("test/processing-time-ranking@main", "gpt-6.1-sol",
            CodexIntegrationProfile.CHATGPT_CODEX_MKT, "Solicitação sintética local");
        request.setStatus(status);
        request.setDurationMs(durationMs);
        request.setTotalTokens(totalTokens);
        return requests.saveAndFlush(request);
    }
}
