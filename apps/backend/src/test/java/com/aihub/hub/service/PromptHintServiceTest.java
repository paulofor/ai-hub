package com.aihub.hub.service;

import com.aihub.hub.domain.PromptHintRecord;
import com.aihub.hub.dto.CreatePromptHintRequest;
import com.aihub.hub.dto.PromptHintView;
import com.aihub.hub.repository.EnvironmentRepository;
import com.aihub.hub.repository.PromptHintRepository;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PromptHintServiceTest {

    private final PromptHintRepository promptHintRepository = mock(PromptHintRepository.class);
    private final EnvironmentRepository environmentRepository = mock(EnvironmentRepository.class);
    private final PromptHintService service = new PromptHintService(promptHintRepository, environmentRepository);

    @Test
    void createStoresPromptTypeWhenTypeIsOmitted() {
        when(promptHintRepository.save(any(PromptHintRecord.class))).thenAnswer((invocation) -> invocation.getArgument(0));

        PromptHintView view = service.create(new CreatePromptHintRequest("Arquitetura", "Manter padrao.", null, null));

        assertThat(view.type()).isEqualTo("prompt");
    }

    @Test
    void createStoresTextTypeForEditableScreenItems() {
        when(promptHintRepository.save(any(PromptHintRecord.class))).thenAnswer((invocation) -> invocation.getArgument(0));

        PromptHintView view = service.create(new CreatePromptHintRequest("Texto editavel", "Texto para editar.", "text", null));

        assertThat(view.type()).isEqualTo("text");
    }

    @Test
    void createRejectsInvalidType() {
        assertThatThrownBy(() -> service.create(new CreatePromptHintRequest("Item", "Texto", "screen", null)))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("Tipo de item opcional inválido");
    }
}
