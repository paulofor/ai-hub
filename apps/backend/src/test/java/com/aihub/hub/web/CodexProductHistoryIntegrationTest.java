package com.aihub.hub.web;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import com.aihub.hub.domain.ProductRecord;
import com.aihub.hub.repository.CodexRequestRepository;
import com.aihub.hub.repository.ProductRepository;
import com.aihub.hub.service.SandboxOrchestratorClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "spring.datasource.url=${product-history-test-db-url:jdbc:h2:mem:product-history-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${product-history-test-db-user:sa}",
    "spring.datasource.password=${product-history-test-db-password:}",
    "spring.datasource.driver-class-name=${product-history-test-db-driver:org.h2.Driver}",
    "spring.flyway.enabled=true",
    "spring.flyway.locations=${product-history-test-migrations:classpath:db/migration/h2}",
    "spring.jpa.hibernate.ddl-auto=validate",
    "hub.codex.app-server-enabled=false",
    "hub.codex.queue-recovery.initial-delay-ms=3600000"
})
@Transactional
class CodexProductHistoryIntegrationTest {
    private static final String URL = "/api/codex/requests/marketing-products";
    private static final Instant NOW = Instant.parse("2026-10-04T10:00:00Z");
    @Autowired private MockMvc mvc;
    @Autowired private CodexRequestRepository requests;
    @Autowired private ProductRepository products;
    @MockBean private SandboxOrchestratorClient sandbox;

    @Test
    void groupsCatalogAndHistoricalNamesUsingOnlyMktActivityAndImmutableProcesses() throws Exception {
        ProductRecord product = product("test/Oferta A");
        product("test/Sem pedidos");
        CodexRequest older = request("test/Oferta A", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.minusSeconds(60));
        older.setProcessNumber("1");
        older.setProcessText("Validar a oferta");
        requests.saveAndFlush(older);
        CodexRequest recent = request("test/Oferta A", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW);
        recent.setProcessNumber("2.1");
        recent.setProcessText("Testar o checkout");
        recent.setStatus(CodexRequestStatus.COMPLETED);
        recent.setStartedAt(NOW.plusSeconds(1));
        recent.setFinishedAt(NOW.plusSeconds(121));
        recent.setDurationMs(120_000L);
        recent.setCost(new BigDecimal("0.012345"));
        recent.setTotalTokens(12_345);
        recent.setResponseText("Resposta privada que não deve entrar no payload");
        requests.saveAndFlush(recent);
        request("test/Oferta A", CodexIntegrationProfile.CHATGPT_CODEX, NOW.plusSeconds(600));
        request("test/Só técnico", CodexIntegrationProfile.STANDARD, NOW.plusSeconds(600));
        request(null, CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.plusSeconds(600));
        request("  ", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.plusSeconds(600));
        product.setName("test/Nome novo");
        products.saveAndFlush(product);

        mvc.perform(get(URL).param("profile", "STANDARD"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.totalElements").value(3))
            .andExpect(jsonPath("$.content[0].productName").value("test/Oferta A"))
            .andExpect(jsonPath("$.content[0].requestCount").value(2))
            .andExpect(jsonPath("$.content[0].latestRequestAt").value(NOW.toString()))
            .andExpect(jsonPath("$.content[0].requests.content[0].id").value(recent.getId()))
            .andExpect(jsonPath("$.content[0].requests.content[0].processNumber").value("2.1"))
            .andExpect(jsonPath("$.content[0].requests.content[0].processText").value("Testar o checkout"))
            .andExpect(jsonPath("$.content[0].requests.content[0].durationMs").value(120_000))
            .andExpect(jsonPath("$.content[0].requests.content[0].cost").value(0.012345))
            .andExpect(jsonPath("$.content[0].requests.content[0].totalTokens").value(12_345))
            .andExpect(jsonPath("$.content[0].requests.content[0].startedAt").value(NOW.plusSeconds(1).toString()))
            .andExpect(jsonPath("$.content[0].requests.content[0].finishedAt").value(NOW.plusSeconds(121).toString()))
            .andExpect(jsonPath("$.content[0].requests.content[1].processNumber").value("1"))
            .andExpect(jsonPath("$.content[0].requests.content[1].processText").value("Validar a oferta"))
            .andExpect(jsonPath("$.content[0].requests.content[0].prompt").doesNotExist())
            .andExpect(jsonPath("$.content[0].requests.content[0].responseText").doesNotExist())
            .andExpect(jsonPath("$.content[0].requests.content[0].executionLog").doesNotExist())
            .andExpect(jsonPath("$.content[1].requests.totalElements").value(0));

        products.delete(product);
        products.flush();
        mvc.perform(get(URL)).andExpect(status().isOk())
            .andExpect(jsonPath("$.totalElements").value(2))
            .andExpect(jsonPath("$.content[0].productName").value("test/Oferta A"));
    }

    @Test
    void paginatesBothProductsAndRequestsInFifteensWithStableTieBreakers() throws Exception {
        CodexRequest latest = null;
        for (int index = 0; index < 17; index++) {
            latest = request("test/Oferta cheia", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW);
        }
        for (int index = 0; index < 16; index++) product("test/Vazio " + index);

        mvc.perform(get(URL))
            .andExpect(status().isOk()).andExpect(jsonPath("$.content.length()").value(15))
            .andExpect(jsonPath("$.totalElements").value(17)).andExpect(jsonPath("$.totalPages").value(2))
            .andExpect(jsonPath("$.content[0].requests.content.length()").value(15))
            .andExpect(jsonPath("$.content[0].requests.totalElements").value(17))
            .andExpect(jsonPath("$.content[0].requests.content[0].id").value(latest.getId()));
        mvc.perform(get(URL).param("page", "1"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.content.length()").value(2))
            .andExpect(jsonPath("$.number").value(1)).andExpect(jsonPath("$.last").value(true));
        mvc.perform(get(URL + "/requests").param("productName", "test/Oferta cheia").param("page", "1"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.content.length()").value(2)).andExpect(jsonPath("$.totalElements").value(17))
            .andExpect(jsonPath("$.content[0].id").value(latest.getId() - 15))
            .andExpect(jsonPath("$.number").value(1)).andExpect(jsonPath("$.last").value(true));
    }

    @Test
    void preservesZeroNullAndActiveStatesAndMatchesProductNamesLiterally() throws Exception {
        String name = "test/Oferta ' especial & + %";
        request("test/Outra", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.plusSeconds(60));
        request(name, CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.minusSeconds(60));
        CodexRequest zero = request(name, CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW);
        zero.setStatus(CodexRequestStatus.CANCELLED);
        zero.setCost(BigDecimal.ZERO);
        zero.setTotalTokens(0);
        zero.setDurationMs(0L);
        requests.saveAndFlush(zero);
        request(name, CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX, NOW.plusSeconds(600));

        mvc.perform(get(URL + "/requests").param("productName", name))
            .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(2))
            .andExpect(jsonPath("$.content[0].status").value("CANCELLED"))
            .andExpect(jsonPath("$.content[0].cost").value(0)).andExpect(jsonPath("$.content[0].totalTokens").value(0))
            .andExpect(jsonPath("$.content[0].durationMs").value(0))
            .andExpect(jsonPath("$.content[1].status").value("PENDING"))
            .andExpect(jsonPath("$.content[1].startedAt").value(nullValue()))
            .andExpect(jsonPath("$.content[1].finishedAt").value(nullValue()))
            .andExpect(jsonPath("$.content[1].cost").value(nullValue()))
            .andExpect(jsonPath("$.content[1].totalTokens").value(nullValue()))
            .andExpect(jsonPath("$.content[1].processNumber").value(nullValue()));
    }

    @Test
    void validatesPaginationAndNamesAndReturnsEmptyPagesWithoutSideEffects() throws Exception {
        mvc.perform(get(URL)).andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get(URL).param("page", "-1")).andExpect(status().isBadRequest());
        mvc.perform(get(URL).param("size", "16")).andExpect(status().isBadRequest());
        mvc.perform(get(URL + "/requests")).andExpect(status().isBadRequest());
        mvc.perform(get(URL + "/requests").param("productName", " ")).andExpect(status().isBadRequest());
        mvc.perform(get(URL + "/requests").param("productName", "x".repeat(151))).andExpect(status().isBadRequest());
        mvc.perform(get(URL + "/requests").param("productName", "test/Não existe").param("size", "100"))
            .andExpect(status().isBadRequest());
        mvc.perform(get(URL + "/requests").param("productName", "test/Não existe").param("page", "-1"))
            .andExpect(status().isBadRequest());
        mvc.perform(get(URL + "/requests").param("productName", "test/Não existe"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.content.length()").value(0))
            .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void selectsFourLatestMktRequestsOfProductBeforeReturningChronologicalPublicDialogue() throws Exception {
        String name = "test/Oferta ' especial & + %";
        var selected = new ArrayList<CodexRequest>();
        for (int index = 0; index < 6; index++) {
            CodexRequest item = request(name, CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.plusSeconds(index));
            item.setUserMessage("Pedido sintético " + index);
            item.setResponseText("Resposta sintética " + index);
            item.setExecutionLog("INTERNAL_LOG_TEST_ONLY");
            item.setModelTranscript("INTERNAL_TRANSCRIPT_TEST_ONLY");
            item.setStatus(CodexRequestStatus.values()[index % 5]);
            // Completion order must not reorder the request/response pairs.
            item.setFinishedAt(NOW.plusSeconds(100 - index));
            selected.add(requests.saveAndFlush(item));
        }
        for (int index = 0; index < 12; index++) {
            request(name, CodexIntegrationProfile.CHATGPT_CODEX, NOW.plusSeconds(200 + index));
            request(name, CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX, NOW.plusSeconds(200 + index));
            request("test/Outro produto", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW.plusSeconds(200 + index));
        }
        long count = requests.count();
        var interactionCount = selected.get(5).getInteractionCount();
        clearInvocations(sandbox);

        String body = mvc.perform(get(URL + "/dialogue").param("productName", name)
                .param("profile", "STANDARD").param("size", "100").param("page", "2"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.length()").value(4))
            .andExpect(jsonPath("$[0].id").value(selected.get(2).getId()))
            .andExpect(jsonPath("$[0].userMessage").value("Pedido sintético 2"))
            .andExpect(jsonPath("$[0].responseText").value("Resposta sintética 2"))
            .andExpect(jsonPath("$[0].status").value("COMPLETED"))
            .andExpect(jsonPath("$[1].id").value(selected.get(3).getId()))
            .andExpect(jsonPath("$[2].id").value(selected.get(4).getId()))
            .andExpect(jsonPath("$[3].id").value(selected.get(5).getId()))
            .andExpect(jsonPath("$[3].userMessage").value("Pedido sintético 5"))
            .andExpect(jsonPath("$[3].responseText").value("Resposta sintética 5"))
            .andExpect(jsonPath("$[3].profile").value("CHATGPT_CODEX_MKT"))
            .andExpect(jsonPath("$[3].productName").value(name))
            .andExpect(jsonPath("$[3].createdAt").value(NOW.plusSeconds(5).toString()))
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(body).doesNotContain("INTERNAL_", "prompt", "executionLog", "modelTranscript", "imageAttachments", "quotaUsage");
        assertThat(requests.count()).isEqualTo(count);
        assertThat(requests.findById(selected.get(5).getId()).orElseThrow().getInteractionCount()).isEqualTo(interactionCount);
        verifyNoInteractions(sandbox);
    }

    @Test
    void ordersEqualDialogueTimestampsByIdAndPreservesMissingPublicContent() throws Exception {
        var selected = new ArrayList<CodexRequest>();
        for (int index = 0; index < 5; index++) {
            selected.add(request("test/Empate", CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW));
        }
        var last = selected.get(4);
        last.setUserMessage(null);
        last.setResponseText(null);
        last.setStatus(CodexRequestStatus.CANCELLED);
        requests.saveAndFlush(last);
        mvc.perform(get(URL + "/dialogue").param("productName", "test/Empate"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(4))
            .andExpect(jsonPath("$[0].id").value(selected.get(1).getId()))
            .andExpect(jsonPath("$[1].id").value(selected.get(2).getId()))
            .andExpect(jsonPath("$[2].id").value(selected.get(3).getId()))
            .andExpect(jsonPath("$[3].id").value(last.getId()))
            .andExpect(jsonPath("$[3].userMessage").value(nullValue()))
            .andExpect(jsonPath("$[3].responseText").value(nullValue()))
            .andExpect(jsonPath("$[3].status").value("CANCELLED"));
    }

    @Test
    void readsHistoricalProductDialogueAndFreshResponsesWithoutCatalogAssociation() throws Exception {
        var product = product("test/Nome histórico");
        var item = request(product.getName(), CodexIntegrationProfile.CHATGPT_CODEX_MKT, NOW);
        item.setUserMessage("Pedido original");
        item.setStatus(CodexRequestStatus.RUNNING);
        requests.saveAndFlush(item);
        product.setName("test/Nome atual");
        products.saveAndFlush(product);
        products.delete(product);
        products.flush();
        mvc.perform(get(URL + "/dialogue").param("productName", "test/Nome histórico"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].userMessage").value("Pedido original"))
            .andExpect(jsonPath("$[0].status").value("RUNNING"));
        item.setStatus(CodexRequestStatus.COMPLETED);
        item.setResponseText("Resposta atualizada");
        item.setFinishedAt(NOW.plusSeconds(60));
        requests.saveAndFlush(item);
        mvc.perform(get(URL + "/dialogue").param("productName", "test/Nome histórico"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$[0].status").value("COMPLETED"))
            .andExpect(jsonPath("$[0].responseText").value("Resposta atualizada"))
            .andExpect(jsonPath("$[0].finishedAt").value(NOW.plusSeconds(60).toString()));
        mvc.perform(get(URL + "/dialogue").param("productName", "test/Nome atual"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void validatesDialogueProductAndReturnsAnEmptyListForProductsWithoutMktRequests() throws Exception {
        mvc.perform(get(URL + "/dialogue")).andExpect(status().isBadRequest());
        for (String invalid : new String[] { "", " ", "x".repeat(151) }) {
            mvc.perform(get(URL + "/dialogue").param("productName", invalid)).andExpect(status().isBadRequest());
        }
        product("test/Somente técnico");
        request("test/Somente técnico", CodexIntegrationProfile.CHATGPT_CODEX, NOW);
        for (String name : new String[] { "test/Não existe", "test/Somente técnico" }) {
            mvc.perform(get(URL + "/dialogue").param("productName", name))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.length()").value(0));
        }
    }

    private ProductRecord product(String name) {
        ProductRecord product = new ProductRecord();
        product.setName(name);
        return products.saveAndFlush(product);
    }

    private CodexRequest request(String name, CodexIntegrationProfile profile, Instant createdAt) {
        CodexRequest request = new CodexRequest("test/product-history@main", "gpt-6.1-sol", profile, "Prompt privado sintético");
        request.setProductName(name);
        request.setCreatedAt(createdAt);
        return requests.saveAndFlush(request);
    }
}
