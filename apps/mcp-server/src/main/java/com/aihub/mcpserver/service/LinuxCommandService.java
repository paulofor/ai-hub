package com.aihub.mcpserver.service;

import com.aihub.mcpserver.model.CommandResponse;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.TimeUnit;

@Service
public class LinuxCommandService {

    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);

    public CommandResponse execute(String command) throws IOException, InterruptedException {
        Process process = new ProcessBuilder("/bin/bash", "-lc", command).start();

        boolean completed = process.waitFor(DEFAULT_TIMEOUT.toSeconds(), TimeUnit.SECONDS);
        if (!completed) {
            process.destroyForcibly();
            return new CommandResponse(124, "", "Command timed out after " + DEFAULT_TIMEOUT.toSeconds() + " seconds");
        }

        int exitCode = process.exitValue();
        String stdout = readStream(process.getInputStream());
        String stderr = readStream(process.getErrorStream());

        return new CommandResponse(exitCode, stdout, stderr);
    }

    private String readStream(java.io.InputStream inputStream) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append(System.lineSeparator());
            }
            return output.toString();
        }
    }
}
