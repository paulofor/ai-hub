package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Transient;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

class CodexRequestTest {

    @Test
    void parsesMaxReasoningEffort() {
        assertThat(CodexReasoningEffort.fromValue("max")).isEqualTo(CodexReasoningEffort.MAX);
        assertThat(CodexReasoningEffort.MAX.value()).isEqualTo("max");
    }

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

    @Test
    void maximumWaitMetricsArePersistedOnTheRequest() throws Exception {
        assertPersistedColumn("maxModelReasoningWaitMs", "max_model_reasoning_wait_ms");
        assertPersistedColumn("reasoningSummary", "reasoning_summary");
        assertPersistedColumn("maxCommandExecutionWaitMs", "max_command_execution_wait_ms");
        assertPersistedColumn("maxExternalServiceWaitMs", "max_external_service_wait_ms");
    }

    private void assertPersistedColumn(String fieldName, String columnName) throws Exception {
        Field field = CodexRequest.class.getDeclaredField(fieldName);
        assertThat(field.getAnnotation(Transient.class)).isNull();
        assertThat(field.getAnnotation(Column.class)).isNotNull();
        assertThat(field.getAnnotation(Column.class).name()).isEqualTo(columnName);
    }
}
