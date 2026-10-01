package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.EnvironmentRecord;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.repository.PromptRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:environment-activation-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "spring.flyway.enabled=true",
    "spring.flyway.locations=classpath:db/migration/h2",
    "spring.jpa.hibernate.ddl-auto=validate",
    "hub.codex.app-server-enabled=false"
})
@Transactional
class EnvironmentActivationIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private EnvironmentRepository environments;
    @Autowired private CodexRequestRepository requests;
    @Autowired private PromptRepository prompts;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void statusPersistsFiltersNewRequestsAndCanBeReactivatedWithoutChangingConnection() throws Exception {
        String payload = """
            {"name":"test/stag-master@main","dbHost":"synthetic-db.local","dbName":"test_db",
             "dbUser":"synthetic","dbPassword":"test-only-password"}
            """;
        String created = mvc.perform(post("/api/environments").contentType(MediaType.APPLICATION_JSON).content(payload))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(true))
            .andReturn().getResponse().getContentAsString();
        long id = mapper.readTree(created).path("id").asLong();
        mvc.perform(patch("/api/environments/{id}/status", id).contentType(MediaType.APPLICATION_JSON).content("{\"active\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false))
            .andExpect(jsonPath("$.dbHost").value("synthetic-db.local"));
        mvc.perform(get("/api/environments")).andExpect(jsonPath("$[0].active").value(false));
        mvc.perform(get("/api/environments/active")).andExpect(jsonPath("$.length()").value(0));

        // Old clients that omit active while editing connection must preserve inactive status.
        mvc.perform(put("/api/environments/{id}", id).contentType(MediaType.APPLICATION_JSON).content(payload))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        for (String profile : new String[] { "STANDARD", "CHATGPT_CODEX", "CHATGPT_CODEX_MKT", "CHATGPT_CODEX_SANDBOX" }) {
            mvc.perform(post("/api/codex/requests").contentType(MediaType.APPLICATION_JSON).content("""
                {"environment":"  TEST/STAG-MASTER@MAIN  ","model":"gpt-6-sol","prompt":"Teste local","profile":"%s"}
                """.formatted(profile)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value(
                    "O ambiente está inativo. Ative-o em Ambientes ou selecione outro ambiente."));
        }
        assertThat(requests.count()).isZero();
        assertThat(prompts.count()).isZero();
        verify(sandbox, never()).createJob(any());

        mvc.perform(patch("/api/environments/{id}/status", id).contentType(MediaType.APPLICATION_JSON).content("{\"active\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(true));
        mvc.perform(get("/api/environments/active")).andExpect(jsonPath("$[0].id").value(id));
        assertThat(environments.findById(id).orElseThrow().getDbPassword()).isEqualTo("test-only-password");
    }

    @Test
    void validatesStatusAndCreatesInactiveExplicitly() throws Exception {
        String created = mvc.perform(post("/api/environments").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"test/sisacao-9@main\",\"active\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false))
            .andReturn().getResponse().getContentAsString();
        long id = mapper.readTree(created).path("id").asLong();
        for (String invalid : new String[] { "{}", "{\"active\":null}" }) {
            mvc.perform(patch("/api/environments/{id}/status", id).contentType(MediaType.APPLICATION_JSON).content(invalid))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors.active").exists());
        }
        mvc.perform(patch("/api/environments/{id}/status", Long.MAX_VALUE).contentType(MediaType.APPLICATION_JSON).content("{\"active\":true}"))
            .andExpect(status().isNotFound());
        assertThat(environments.findById(id).orElseThrow().isActive()).isFalse();
    }

    @Test
    void requestsKeepSharedIdsAndQueueWhileDeactivationPreservesAlreadyAcceptedWork() throws Exception {
        environments.saveAndFlush(new EnvironmentRecord("test/stag-master@main", "Fixture local"));
        EnvironmentRecord other = environments.saveAndFlush(new EnvironmentRecord("test/sisacao-9@main", "Fixture local"));
        CodexRequest running = new CodexRequest("test/stag-master@main", "gpt-6-sol", CodexIntegrationProfile.CHATGPT_CODEX, "Em execução");
        running.setStatus(CodexRequestStatus.RUNNING);
        running.setExternalId("synthetic-running-job");
        requests.saveAndFlush(running);
        clearInvocations(sandbox);
        String created = mvc.perform(post("/api/codex/requests").contentType(MediaType.APPLICATION_JSON).content("""
            {"environment":"test/sisacao-9@main","model":"gpt-6-sol","prompt":"Segundo envio","profile":"CHATGPT_CODEX"}
            """))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"))
            .andReturn().getResponse().getContentAsString();
        long queuedId = mapper.readTree(created).path("id").asLong();
        assertThat(queuedId).isGreaterThan(running.getId());
        verify(sandbox, never()).createJob(any());
        mvc.perform(patch("/api/environments/{id}/status", other.getId()).contentType(MediaType.APPLICATION_JSON).content("{\"active\":false}"))
            .andExpect(status().isOk());
        assertThat(requests.findById(queuedId).orElseThrow().getStatus()).isEqualTo(CodexRequestStatus.PENDING);
        assertThat(requests.findById(running.getId()).orElseThrow().getStatus()).isEqualTo(CodexRequestStatus.RUNNING);
    }
}
