package com.aihub.hub.dto;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PromptHintRequestValidationTest {

    private final Validator validator;

    PromptHintRequestValidationTest() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        this.validator = factory.getValidator();
    }

    @Test
    void updateAcceptsLongPromptHintText() {
        String phrase = "a".repeat(5000);

        assertThat(validator.validate(new UpdatePromptHintRequest("Cockpit PDE", phrase, "text", 1L))).isEmpty();
    }

    @Test
    void updateRejectsPromptHintTextAboveConfiguredLimit() {
        String phrase = "a".repeat(10001);

        assertThat(validator.validate(new UpdatePromptHintRequest("Cockpit PDE", phrase, "text", 1L)))
            .anySatisfy(violation -> {
                assertThat(violation.getPropertyPath().toString()).isEqualTo("phrase");
                assertThat(violation.getMessage()).contains("10000 caracteres");
            });
    }

    @Test
    void createRejectsPromptHintTextAboveConfiguredLimit() {
        String phrase = "a".repeat(10001);

        assertThat(validator.validate(new CreatePromptHintRequest("Cockpit PDE", phrase, "text", 1L)))
            .anySatisfy(violation -> {
                assertThat(violation.getPropertyPath().toString()).isEqualTo("phrase");
                assertThat(violation.getMessage()).contains("10000 caracteres");
            });
    }
}
