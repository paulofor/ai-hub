package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Transient;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

class CodexRequestTest {

    @Test
    void profileColumnFitsSandboxProfileName() throws Exception {
        Field field = CodexRequest.class.getDeclaredField("profile");

        Column column = field.getAnnotation(Column.class);

        assertThat(column).isNotNull();
        assertThat(column.length()).isGreaterThanOrEqualTo(CodexIntegrationProfile.CHATGPT_CODEX_SANDBOX.name().length());
    }

    @Test
    void interactionCountIsPersistedAsRequestSummary() throws Exception {
        Field field = CodexRequest.class.getDeclaredField("interactionCount");

        assertThat(field.getAnnotation(Transient.class)).isNull();
        assertThat(field.getAnnotation(Column.class)).isNotNull();
        assertThat(field.getAnnotation(Column.class).name()).isEqualTo("interaction_count");
    }
}
