package com.aihub.hub.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

/** Versioned public projection; unknown/private fields never reach request details. */
final class ExecutionTracePayload {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final List<String> STATES = List.of("pending", "running", "completed", "failed", "cancelled");
    private ExecutionTracePayload() { }

    static String normalize(JsonNode value) {
        if (value == null || value.isNull() || value.toString().length() > 12_000_000) return null;
        try {
            JsonNode node = value.isTextual() ? MAPPER.readTree(value.asText()) : value;
            if (!node.isObject() || node.path("version").asInt() != 1 || !node.path("revision").isIntegralNumber()
                || node.path("revision").asLong() <= 0 || !node.path("plans").isArray() || !node.path("events").isArray()) return null;
            Trace trace = MAPPER.treeToValue(node, Trace.class);
            if (trace.plans().size() > 80 || trace.events().size() > 400) return null;
            for (Plan plan : trace.plans()) {
                if (plan.id() == null || plan.turnId() == null || plan.receivedAt() == null || plan.steps() == null || plan.steps().size() > 40) return null;
                for (Step step : plan.steps()) if (step.step() == null || !STATES.contains(step.status())) return null;
            }
            for (Event event : trace.events()) {
                if (event.id() == null || event.turnId() == null || event.label() == null || event.receivedAt() == null
                    || !STATES.contains(event.status()) || event.evidence() == null || event.evidence().size() > 8) return null;
            }
            return MAPPER.writeValueAsString(trace);
        } catch (Exception ignored) { return null; }
    }

    static long revision(String value) {
        if (value == null) return 0;
        try { return MAPPER.readTree(value).path("revision").asLong(0); }
        catch (Exception ignored) { return 0; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Trace(int version, long revision, List<Plan> plans, List<Event> events, int droppedEvents, int droppedPlans) { }
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Plan(String id, String turnId, String receivedAt, String explanation, List<Step> steps) { }
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Step(String step, String status) { }
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Event(String id, long sequence, String turnId, String itemId, String planId, Integer stepIndex,
        String kind, String label, String status, String receivedAt, String finishedAt, Long durationMs,
        String durationSource, String result, Details details, List<Evidence> evidence) { }
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Details(String command, String output, List<String> files) { }
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Evidence(String label, String url) { }
}
