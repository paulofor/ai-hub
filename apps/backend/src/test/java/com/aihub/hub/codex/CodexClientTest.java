package com.aihub.hub.codex;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.client.RestClient;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.assertj.core.api.Assertions.assertThat;

class CodexClientTest {

    @Test
    void resolveApiKeyReadsFromHomeDirectoryTokenFile(@TempDir Path tempHome) throws Exception {
        String originalHome = System.getProperty("user.home");
        System.setProperty("user.home", tempHome.toString());

        try {
            Path keyFile = tempHome.resolve(Paths.get("infra", "openai-token", "openai_api_key"));
            Files.createDirectories(keyFile.getParent());
            Files.writeString(keyFile, "token-from-home");

            CodexClient client = new CodexClient(
                RestClient.builder().baseUrl("http://localhost").build(),
                new ObjectMapper(),
                "",
                "",
                "gpt-5-codex"
            );

            Field apiKeyField = CodexClient.class.getDeclaredField("apiKey");
            apiKeyField.setAccessible(true);

            assertThat(apiKeyField.get(client)).isEqualTo("token-from-home");
        } finally {
            System.setProperty("user.home", originalHome);
        }
    }
}
