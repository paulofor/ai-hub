package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.EnvironmentRecord;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.repository.PromptHintRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import com.fasterxml.jackson.databind.JsonNode;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=${prompt-hint-test-db-url:jdbc:h2:mem:prompt-hint-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${prompt-hint-test-db-user:sa}",
    "spring.datasource.password=${prompt-hint-test-db-password:}",
    "spring.datasource.driver-class-name=${prompt-hint-test-db-driver:org.h2.Driver}",
    "spring.flyway.enabled=true",
    "spring.flyway.locations=${prompt-hint-test-migrations:classpath:db/migration/h2}",
    "spring.jpa.hibernate.ddl-auto=validate",
    "hub.codex.app-server-enabled=false",
    "hub.codex.queue-recovery.initial-delay-ms=3600000"
})
@Transactional
class PromptHintActivationIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private EnvironmentRepository environments;
    @Autowired private PromptHintRepository hints;
    @Autowired private CodexRequestRepository requests;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void inactiveItemsStayInManagementAndAreExcludedFromEveryEnvironmentUntilReactivated() throws Exception {
        var environment = environments.saveAndFlush(new EnvironmentRecord("test/prompt-items@main", "Fixture local"));
        var other = environments.saveAndFlush(new EnvironmentRecord("test/other@main", "Fixture local"));
        var global = create("Global ativo", "prompt", null, null);
        var scoped = create("Tela ativa", "text", environment.getId(), null);
        create("Global inativo", "text", null, false);
        create("Prompt inativo", "prompt", environment.getId(), false);
        create("Outro ambiente", "prompt", other.getId(), true);
        mvc.perform(get("/api/prompt-hints")).andExpect(jsonPath("$.length()").value(5));
        mvc.perform(get("/api/prompt-hints").param("environment", "  TEST/PROMPT-ITEMS@MAIN  "))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(global.path("id").asLong()))
            .andExpect(jsonPath("$[1].id").value(scoped.path("id").asLong()));
        long id = scoped.path("id").asLong();
        mvc.perform(patch("/api/prompt-hints/{id}/status", id).contentType(MediaType.APPLICATION_JSON).content("{\"active\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false))
            .andExpect(jsonPath("$.phrase").value(scoped.path("phrase").asText()))
            .andExpect(jsonPath("$.type").value("text"))
            .andExpect(jsonPath("$.environmentId").value(environment.getId()));
        hints.flush();
        assertThat(hints.findById(id).orElseThrow().isActive()).isFalse();
        mvc.perform(get("/api/prompt-hints").param("environment", environment.getName()))
            .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/prompt-hints").param("environment", "test/unknown@main"))
            .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].label").value("Global ativo"));
        mvc.perform(patch("/api/prompt-hints/{id}/status", id).contentType(MediaType.APPLICATION_JSON).content("{\"active\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id)).andExpect(jsonPath("$.active").value(true));
        mvc.perform(get("/api/prompt-hints").param("environment", environment.getName()))
            .andExpect(jsonPath("$.length()").value(2));
        assertThat(hints.count()).isEqualTo(5);
        assertThat(requests.count()).isZero();
    }

    @Test
    void editingWithoutStatusPreservesInactiveAndExplicitStatusCanBeChanged() throws Exception {
        long id = create("Item inativo", "prompt", null, false).path("id").asLong();
        mvc.perform(put("/api/prompt-hints/{id}", id).contentType(MediaType.APPLICATION_JSON)
                .content("{\"label\":\"Editado\",\"phrase\":\"Texto editado\",\"type\":\"text\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        mvc.perform(put("/api/prompt-hints/{id}", id).contentType(MediaType.APPLICATION_JSON)
                .content("{\"label\":\"Editado\",\"phrase\":\"Texto editado\",\"active\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(true));
        mvc.perform(put("/api/prompt-hints/{id}", id).contentType(MediaType.APPLICATION_JSON)
                .content("{\"label\":\"Editado\",\"phrase\":\"Texto editado\",\"active\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        mvc.perform(delete("/api/prompt-hints/{id}", id)).andExpect(status().isNoContent());
        assertThat(hints.existsById(id)).isFalse();
    }

    @Test
    void invalidStatusOrMissingItemDoesNotChangeStoredData() throws Exception {
        long id = create("Item", "prompt", null, null).path("id").asLong();
        for (String invalid : new String[] { "{}", "{\"active\":null}" }) {
            mvc.perform(patch("/api/prompt-hints/{id}/status", id).contentType(MediaType.APPLICATION_JSON).content(invalid))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors.active").exists());
        }
        mvc.perform(patch("/api/prompt-hints/{id}/status", Long.MAX_VALUE).contentType(MediaType.APPLICATION_JSON).content("{\"active\":false}"))
            .andExpect(status().isNotFound());
        assertThat(hints.findById(id).orElseThrow().isActive()).isTrue();
    }

    @Test
    void statusChangesPreserveAcceptedRequestPromptAndScreenItemSnapshot() throws Exception {
        var item = create("Tela histórica", "text", null, true);
        var request = new CodexRequest("test/prompt-items@main", "gpt-6-sol", CodexIntegrationProfile.CHATGPT_CODEX_MKT, "Texto aceito antes da inativação");
        request.setStatus(CodexRequestStatus.COMPLETED);
        String snapshot = mapper.writeValueAsString(java.util.List.of(java.util.Map.of(
            "id", item.path("id").asLong(), "label", item.path("label").asText(), "phrase", item.path("phrase").asText())));
        request.setScreenPromptItemsJson(snapshot);
        requests.saveAndFlush(request);
        mvc.perform(patch("/api/prompt-hints/{id}/status", item.path("id").asLong()).contentType(MediaType.APPLICATION_JSON).content("{\"active\":false}"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/codex/requests/{id}", request.getId()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.screenPromptItems[0].id").value(item.path("id").asLong()))
            .andExpect(jsonPath("$.screenPromptItems[0].phrase").value(item.path("phrase").asText()))
            .andExpect(jsonPath("$.status").value("COMPLETED"));
        assertThat(requests.findById(request.getId()).orElseThrow().getPrompt()).isEqualTo("Texto aceito antes da inativação");
    }

    private JsonNode create(String label, String type, Long environmentId, Boolean active) throws Exception {
        var payload = mapper.createObjectNode().put("label", label).put("phrase", "Texto sintético de " + label).put("type", type);
        if (environmentId != null) payload.put("environmentId", environmentId);
        if (active != null) payload.put("active", active);
        String body = mvc.perform(post("/api/prompt-hints").contentType(MediaType.APPLICATION_JSON).content(payload.toString()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(active == null || active))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return mapper.readTree(body);
    }
}
