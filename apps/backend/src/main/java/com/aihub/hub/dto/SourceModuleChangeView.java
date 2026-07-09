package com.aihub.hub.dto;

import java.time.Instant;

public record SourceModuleChangeView(
    String name,
    String path,
    Instant lastChangedAt,
    long daysSinceLastChange
) {
}
