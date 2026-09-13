package com.aihub.hub.dto;

import java.time.Instant;

public record ProcessView(Long id, String number, String text, Instant createdAt, Instant updatedAt) {}
