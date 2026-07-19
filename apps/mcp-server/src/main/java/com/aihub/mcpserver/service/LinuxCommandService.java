package com.aihub.mcpserver.service;

import com.aihub.mcpserver.model.CommandResponse;
import com.aihub.mcpserver.config.McpServerProperties;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

@Service
public class LinuxCommandService {

    private final McpServerProperties properties;

    public LinuxCommandService(McpServerProperties properties) {
        this.properties = properties;
    }

    public CommandResponse execute(String command) throws IOException, InterruptedException {
        Process process = new ProcessBuilder("/bin/bash", "-lc", command).start();
        CompletableFuture<String> stdout = CompletableFuture.supplyAsync(() -> readStream(process.getInputStream()));
        CompletableFuture<String> stderr = CompletableFuture.supplyAsync(() -> readStream(process.getErrorStream()));

        boolean completed = process.waitFor(properties.commandTimeoutSeconds(), TimeUnit.SECONDS);
        if (!completed) {
            process.destroyForcibly();
            return new CommandResponse(
                    124,
                    stdout.getNow(""),
                    "Command timed out after " + properties.commandTimeoutSeconds() + " seconds");
        }

        int exitCode = process.exitValue();
        return new CommandResponse(exitCode, stdout.join(), stderr.join());
    }

    private String readStream(java.io.InputStream inputStream) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            boolean truncated = false;
            while ((line = reader.readLine()) != null) {
                if (!truncated) {
                    output.append(line).append(System.lineSeparator());
                    if (output.length() > properties.maxOutputChars()) {
                        output.setLength(properties.maxOutputChars());
                        output.append(System.lineSeparator()).append("[output truncated]");
                        truncated = true;
                    }
                }
            }
            return output.toString();
        } catch (IOException e) {
            return e.getMessage();
        }
    }
}
