package com.aihub.hub.dto;

import com.aihub.hub.domain.EnvironmentRecord;

import java.time.Instant;

public record EnvironmentView(Long id, String name, String description, Instant createdAt) {

    public static EnvironmentView from(EnvironmentRecord record) {
        return new EnvironmentView(record.getId(), record.getName(), record.getDescription(), record.getCreatedAt());
    }
}
