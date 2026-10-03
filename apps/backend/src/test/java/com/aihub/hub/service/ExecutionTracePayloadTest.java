package com.aihub.hub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class ExecutionTracePayloadTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void pollingReadsVersionedTraceAndDropsPrivateFields() throws Exception {
        var trace = mapper.readTree("""
            {"version":1,"revision":2,"plans":[],"events":[{
              "id":"command","sequence":1,"turnId":"turn","kind":"command","label":"Executar comando",
              "status":"failed","receivedAt":"2026-10-03T12:00:00Z","evidence":[],
              "content":"RAW_REASONING","arguments":{"secret":"PRIVATE_ARGUMENT"},
              "details":{"command":"npm test","output":"Um teste falhou","content":"PRIVATE_DETAILS"}
            }],"content":"PRIVATE_ROOT"}
            """);
        for (String key : java.util.List.of("executionTrace", "execution_trace")) {
            var payload = mapper.createObjectNode().put("status", "RUNNING");
            payload.set(key, trace);
            var response = SandboxOrchestratorClient.SandboxOrchestratorJobResponse.from(payload);
            assertThat(response.executionTrace()).contains("npm test", "failed").doesNotContain("RAW_REASONING", "PRIVATE");
            assertThat(ExecutionTracePayload.revision(response.executionTrace())).isEqualTo(2);
        }
    }

    @Test
    void invalidMissingAndUnsupportedTraceStayAbsent() throws Exception {
        for (String json : java.util.List.of("null", "{}", "{\"version\":2,\"revision\":1,\"events\":[],\"plans\":[]}",
            "{\"version\":1,\"revision\":-1,\"events\":[],\"plans\":[]}",
            "{\"version\":1,\"revision\":1,\"events\":[{}],\"plans\":[]}", "\"malformed\"")) {
            assertThat(ExecutionTracePayload.normalize(mapper.readTree(json))).isNull();
        }
        assertThat(ExecutionTracePayload.revision("broken")).isZero();
    }
}
