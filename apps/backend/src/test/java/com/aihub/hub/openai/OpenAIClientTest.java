package com.aihub.hub.openai;

import com.aihub.hub.dto.CiFix;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class OpenAIClientTest {

    @Test
    void parsesCiFixResponse() {
        RestClient.Builder builder = RestClient.builder().baseUrl("https://api.openai.com");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).ignoreExpectOrder(true).build();
        RestClient restClient = builder.build();
        String json = "{\"output\":[{\"content\":[{\"text\":\"{\\\"root_cause\\\":\\\"Erro\\\",\\\"fix_plan\\\":\\\"Ajustar\\\",\\\"unified_diff\\\":\\\"diff\\\",\\\"confidence\\\":0.9}\"}]}]}";
        server.expect(requestTo("https://api.openai.com/v1/responses"))
            .andExpect(header("Authorization", "Bearer test"))
            .andRespond(withSuccess(json, MediaType.APPLICATION_JSON));
        OpenAIClient client = new OpenAIClient(restClient, new ObjectMapper(), "test", "gpt-4.1");
        CiFix fix = client.analyzeLogs("logs", Map.of("repo", "org/repo"));
        assertThat(fix.getRootCause()).isEqualTo("Erro");
        assertThat(fix.getFixPlan()).isEqualTo("Ajustar");
        assertThat(fix.getUnifiedDiff()).isEqualTo("diff");
        assertThat(fix.getConfidence()).isEqualTo(0.9);
        server.verify();
    }
}
