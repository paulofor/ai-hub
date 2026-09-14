package com.aihub.hub.service;

import com.aihub.hub.domain.ProcessRecord;
import com.aihub.hub.dto.ProcessRequest;
import com.aihub.hub.repository.ProcessRepository;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProcessServiceTest {

    private final ProcessRepository repository = mock(ProcessRepository.class);
    private final ProcessService service = new ProcessService(repository);

    @Test
    void createsSubprocessLinkedToMainProcess() {
        ProcessRecord parent = process("6", "Processo principal");
        when(repository.findById(6L)).thenReturn(Optional.of(parent));
        when(repository.save(any(ProcessRecord.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var result = service.create(new ProcessRequest("6.1", "Primeiro subprocesso", 6L));

        assertThat(result.number()).isEqualTo("6.1");
        assertThat(result.parentProcessNumber()).isEqualTo("6");
    }

    @Test
    void rejectsSubprocessNumberOutsideParentSequence() {
        when(repository.findById(6L)).thenReturn(Optional.of(process("6", "Processo principal")));

        assertThatThrownBy(() -> service.create(new ProcessRequest("5.2", "Subprocesso inválido", 6L)))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("formato 6.1");
    }

    @Test
    void rejectsASecondHierarchyLevel() {
        ProcessRecord subprocess = process("6.1", "Subprocesso");
        subprocess.setParentProcess(process("6", "Processo principal"));
        when(repository.findById(61L)).thenReturn(Optional.of(subprocess));

        assertThatThrownBy(() -> service.create(new ProcessRequest("6.1.1", "Nível inválido", 61L)))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("não outro subprocesso");
    }

    private ProcessRecord process(String number, String text) {
        ProcessRecord process = new ProcessRecord();
        process.setNumber(number);
        process.setText(text);
        return process;
    }
}
