package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Transient;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

class CodexRequestTest {

    @Test
    void interactionCountIsPersistedAsRequestSummary() throws Exception {
        Field field = CodexRequest.class.getDeclaredField("interactionCount");

        assertThat(field.getAnnotation(Transient.class)).isNull();
        assertThat(field.getAnnotation(Column.class)).isNotNull();
        assertThat(field.getAnnotation(Column.class).name()).isEqualTo("interaction_count");
    }
}
