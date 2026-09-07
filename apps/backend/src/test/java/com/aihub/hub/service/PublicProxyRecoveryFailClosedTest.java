package com.aihub.hub.service;

import com.aihub.hub.config.PublicProxyRecoveryProperties;
import com.aihub.hub.dto.PublicProxyRecoveryRequest;
import com.aihub.hub.github.GithubApiClient;
import com.aihub.hub.repository.PublicProxyRecoveryRepository;
import com.aihub.hub.web.PublicProxyRecoveryController;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class PublicProxyRecoveryFailClosedTest {

    @Test
    void disabledOperationNeverTouchesPersistenceOrGithub() {
        PublicProxyRecoveryRepository repository = mock(PublicProxyRecoveryRepository.class);
        GithubApiClient github = mock(GithubApiClient.class);
        PublicProxyRecoveryService service = new PublicProxyRecoveryService(
            repository,
            new PublicProxyRecoveryProperties(
                false,
                "paulofor",
                "marketing-hub",
                "recover-public-proxy.yml",
                "main",
                "kit-whatsapp-pronto-public-proxy",
                600,
                25
            ),
            github,
            mock(AuditService.class),
            Clock.systemUTC()
        );

        assertThatThrownBy(() -> service.submit(new PublicProxyRecoveryRequest(
            UUID.randomUUID(),
            "Operação explicitamente desabilitada",
            "RECOVER_PUBLIC_PROXY"
        )))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Recuperação do proxy não está habilitada");
        verifyNoInteractions(repository, github);
    }

    @Test
    void backendEndpointFailsClosedWithoutSharedToken() {
        PublicProxyRecoveryService service = mock(PublicProxyRecoveryService.class);
        PublicProxyRecoveryController controller = new PublicProxyRecoveryController(service, "");

        assertThatThrownBy(() -> controller.submit(
            new PublicProxyRecoveryRequest(
                UUID.randomUUID(),
                "Operação sem segredo compartilhado",
                "RECOVER_PUBLIC_PROXY"
            ),
            null
        ))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("503 SERVICE_UNAVAILABLE");
        verifyNoInteractions(service);
    }
}
