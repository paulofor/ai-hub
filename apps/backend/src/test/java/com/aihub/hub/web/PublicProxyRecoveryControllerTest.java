package com.aihub.hub.web;

import com.aihub.hub.domain.PublicProxyRecoveryStatus;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.AuditLogRepository;
import com.aihub.hub.repository.PublicProxyRecoveryRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(properties = {
    "hub.mcp.api-token=test-token",
    "hub.public-proxy-recovery.enabled=true",
    "hub.public-proxy-recovery.cooldown-seconds=600"
})
class PublicProxyRecoveryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PublicProxyRecoveryRepository repository;

    @Autowired
    private AuditLogRepository auditRepository;

    @MockBean
    private GithubApiClient githubApiClient;

    @BeforeEach
    void resetState() {
        auditRepository.deleteAll();
        repository.deleteAll();
        reset(githubApiClient);
    }

    @Test
    void dispatchesFixedWorkflowAndPersistsAudit() throws Exception {
        UUID requestId = UUID.fromString("f6f40ccc-003a-457b-88e2-2527b2b7b807");

        mockMvc.perform(post("/api/internal/operations/public-proxy-recoveries")
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request(requestId, "Proxy indisponível após reinício", "RECOVER_PUBLIC_PROXY")))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.operation").value("recover-public-proxy"))
            .andExpect(jsonPath("$.target").value("kit-whatsapp-pronto-public-proxy"))
            .andExpect(jsonPath("$.status").value("DISPATCHED"));

        verify(githubApiClient).dispatchWorkflow(
            eq("paulofor"),
            eq("marketing-hub"),
            eq("recover-public-proxy.yml"),
            eq("main"),
            eq(Map.of(
                "request_id", requestId.toString(),
                "reason", "Proxy indisponível após reinício",
                "confirmation", "RECOVER_PUBLIC_PROXY"
            ))
        );
        assertThat(repository.findByRequestId(requestId.toString())).isPresent();
        assertThat(auditRepository.findAll())
            .extracting("action")
            .containsExactly("public_proxy_recovery_requested", "public_proxy_recovery_dispatched");
    }

    @Test
    void repeatedRequestIsIdempotentAndDoesNotDispatchTwice() throws Exception {
        UUID requestId = UUID.fromString("ab64577d-fdfc-4dc2-a07d-dfc25a210f4f");
        String payload = request(requestId, "Mesmo diagnóstico operacional", "RECOVER_PUBLIC_PROXY");

        mockMvc.perform(post("/api/internal/operations/public-proxy-recoveries")
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isAccepted());
        mockMvc.perform(post("/api/internal/operations/public-proxy-recoveries")
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DISPATCHED"));

        verify(githubApiClient, times(1)).dispatchWorkflow(any(), any(), any(), any(), any());
        assertThat(repository.count()).isEqualTo(1);
    }

    @Test
    void rejectsRequestIdReuseWithDifferentReason() throws Exception {
        UUID requestId = UUID.fromString("7f376523-a278-4d43-917a-b65ebc2389eb");

        submit(requestId, "Primeiro motivo auditável").andExpect(status().isAccepted());
        submit(requestId, "Segundo motivo incompatível")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("requestId já foi usado com outro motivo"));

        verify(githubApiClient, times(1)).dispatchWorkflow(any(), any(), any(), any(), any());
    }

    @Test
    void enforcesCooldownAcrossDifferentRequestIds() throws Exception {
        submit(UUID.fromString("e2232364-0ac9-49f2-94f8-c98d5807fbde"), "Primeira recuperação controlada")
            .andExpect(status().isAccepted());

        submit(UUID.fromString("ca857f50-f993-4dee-8d0d-9dc5ea78a675"), "Segunda recuperação prematura")
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists(HttpHeaders.RETRY_AFTER));

        verify(githubApiClient, times(1)).dispatchWorkflow(any(), any(), any(), any(), any());
    }

    @Test
    void rejectsMissingBearerAndInvalidConfirmationBeforeDispatch() throws Exception {
        UUID requestId = UUID.fromString("d3b0f3b4-9f20-4339-b393-43924d2fc100");

        mockMvc.perform(post("/api/internal/operations/public-proxy-recoveries")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request(requestId, "Tentativa sem autenticação", "RECOVER_PUBLIC_PROXY")))
            .andExpect(status().isUnauthorized());

        submit(requestId, "Tentativa sem confirmação válida", "CONFIRM")
            .andExpect(status().isBadRequest());

        verifyNoInteractions(githubApiClient);
    }

    @Test
    void rejectsReasonThatBecomesTooShortAfterNormalization() throws Exception {
        submit(
            UUID.fromString("5a1f4f9d-f716-4e62-a926-e74de1cf4717"),
            "       curto"
        )
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Motivo deve ter entre 8 e 500 caracteres sem controles"));

        verifyNoInteractions(githubApiClient);
        assertThat(repository.count()).isZero();
    }

    @Test
    void rejectsUnknownOperationalTargetFields() throws Exception {
        mockMvc.perform(post("/api/internal/operations/public-proxy-recoveries")
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "requestId": "30de9529-dac7-4e47-bf10-b8c698c081ec",
                      "reason": "Tentativa de controlar o alvo",
                      "confirmation": "RECOVER_PUBLIC_PROXY",
                      "host": "outro-host",
                      "command": "docker restart qualquer-coisa"
                    }
                    """))
            .andExpect(status().isBadRequest());

        verifyNoInteractions(githubApiClient);
        assertThat(repository.count()).isZero();
    }

    @Test
    void marksRecoveryOnlyAfterGithubRunSucceeds() throws Exception {
        UUID requestId = UUID.fromString("511375f8-852e-4cb0-a8ae-8c11bd8cd9f3");
        submit(requestId, "Recuperar e confirmar todas as sondas")
            .andExpect(status().isAccepted());
        when(githubApiClient.listWorkflowRuns(
            "paulofor", "marketing-hub", "recover-public-proxy.yml", "main", 25
        )).thenReturn(objectMapper.readTree("""
            {
              "workflow_runs": [{
                "id": 9182,
                "display_title": "Recover public proxy [511375f8-852e-4cb0-a8ae-8c11bd8cd9f3]",
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://github.example/runs/9182"
              }]
            }
            """));

        mockMvc.perform(get("/api/internal/operations/public-proxy-recoveries/{requestId}", requestId)
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("RECOVERED"))
            .andExpect(jsonPath("$.githubRunId").value(9182))
            .andExpect(jsonPath("$.githubRunUrl").value("https://github.example/runs/9182"));

        assertThat(repository.findByRequestId(requestId.toString()).orElseThrow().getStatus())
            .isEqualTo(PublicProxyRecoveryStatus.RECOVERED);
    }

    @Test
    void keepsDispatchStateWhenRunIsNotVisibleYetAndMarksFailedRun() throws Exception {
        UUID requestId = UUID.fromString("3cc43246-2151-43f1-bf48-7243a890eef7");
        submit(requestId, "Acompanhar execução até conclusão")
            .andExpect(status().isAccepted());
        when(githubApiClient.listWorkflowRuns(
            "paulofor", "marketing-hub", "recover-public-proxy.yml", "main", 25
        )).thenReturn(objectMapper.readTree("{\"workflow_runs\":[]}"));

        mockMvc.perform(get("/api/internal/operations/public-proxy-recoveries/{requestId}", requestId)
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DISPATCHED"));

        when(githubApiClient.listWorkflowRuns(
            "paulofor", "marketing-hub", "recover-public-proxy.yml", "main", 25
        )).thenReturn(objectMapper.readTree("""
            {
              "workflow_runs": [{
                "id": 9183,
                "display_title": "Recover public proxy [3cc43246-2151-43f1-bf48-7243a890eef7]",
                "status": "completed",
                "conclusion": "failure",
                "html_url": "https://github.example/runs/9183"
              }]
            }
            """));

        mockMvc.perform(get("/api/internal/operations/public-proxy-recoveries/{requestId}", requestId)
                .header(HttpHeaders.AUTHORIZATION, "Bearer test-token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("FAILED"));
    }

    @Test
    void persistsDispatchFailureWithoutRetryingImplicitly() throws Exception {
        UUID requestId = UUID.fromString("6f24ad99-f665-43ef-841b-b6304aa20c94");
        doThrow(new IllegalStateException("github unavailable"))
            .when(githubApiClient).dispatchWorkflow(any(), any(), any(), any(), any());

        submit(requestId, "GitHub indisponível durante o despacho")
            .andExpect(status().isBadGateway());

        assertThat(repository.findByRequestId(requestId.toString()).orElseThrow().getStatus())
            .isEqualTo(PublicProxyRecoveryStatus.DISPATCH_FAILED);
        verify(githubApiClient, times(1)).dispatchWorkflow(any(), any(), any(), any(), any());
    }

    private org.springframework.test.web.servlet.ResultActions submit(UUID requestId, String reason)
            throws Exception {
        return submit(requestId, reason, "RECOVER_PUBLIC_PROXY");
    }

    private org.springframework.test.web.servlet.ResultActions submit(
        UUID requestId,
        String reason,
        String confirmation
    ) throws Exception {
        return mockMvc.perform(post("/api/internal/operations/public-proxy-recoveries")
            .header(HttpHeaders.AUTHORIZATION, "Bearer test-token")
            .contentType(MediaType.APPLICATION_JSON)
            .content(request(requestId, reason, confirmation)));
    }

    private String request(UUID requestId, String reason, String confirmation) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
            "requestId", requestId,
            "reason", reason,
            "confirmation", confirmation
        ));
    }
}
