package com.aihub.mcpserver.controller;

import com.aihub.mcpserver.model.CommandRequest;
import com.aihub.mcpserver.model.CommandResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "mcp.server.api-token=test-token",
                "mcp.server.command-timeout-seconds=5",
                "mcp.server.max-output-chars=4096"
        })
class McpServerAuthControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void linuxCommandRejectsMissingBearerTokenWhenApiTokenIsConfigured() throws Exception {
        mockMvc.perform(post("/mcp/tools/linux-command")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"command\":\"printf hello\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void linuxCommandExecutesWithBearerTokenWhenApiTokenIsConfigured() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("test-token");
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<CommandRequest> entity = new HttpEntity<>(new CommandRequest("printf hello"), headers);

        ResponseEntity<CommandResponse> response = restTemplate.exchange(
                "/mcp/tools/linux-command",
                HttpMethod.POST,
                entity,
                CommandResponse.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().exitCode()).isZero();
        assertThat(response.getBody().stdout()).isEqualTo("hello\n");
        assertThat(response.getBody().stderr()).isEmpty();
    }
}
