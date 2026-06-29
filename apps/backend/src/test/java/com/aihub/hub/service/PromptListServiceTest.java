package com.aihub.hub.service;

import com.aihub.hub.domain.PromptListRecord;
import com.aihub.hub.dto.PromptListView;
import com.aihub.hub.repository.PromptListRepository;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PromptListServiceTest {

    private final PromptListRepository promptListRepository = mock(PromptListRepository.class);
    private final PromptListService service = new PromptListService(promptListRepository);

    @Test
    void createReplacesItemsWhenListNameAlreadyExists() {
        PromptListRecord existing = new PromptListRecord("Inicial", "antigo.md");
        existing.addItem("prompt antigo 1", 1);
        existing.addItem("prompt antigo 2", 2);
        when(promptListRepository.findByNameWithItems("Inicial")).thenReturn(Optional.of(existing));
        when(promptListRepository.save(existing)).thenReturn(existing);

        MockMultipartFile file = new MockMultipartFile(
            "file",
            "novo.md",
            "text/markdown",
            "* prompt novo 1\n* prompt novo 2\n".getBytes(StandardCharsets.UTF_8)
        );

        PromptListView view = service.create("Inicial", file);

        verify(promptListRepository).findByNameWithItems("Inicial");
        verify(promptListRepository).save(existing);
        assertThat(view.name()).isEqualTo("Inicial");
        assertThat(view.sourceFilename()).isEqualTo("novo.md");
        assertThat(view.items())
            .extracting("position", "prompt")
            .containsExactly(
                org.assertj.core.api.Assertions.tuple(1, "prompt novo 1"),
                org.assertj.core.api.Assertions.tuple(2, "prompt novo 2")
            );
    }
}
