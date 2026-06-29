package com.aihub.hub.dto;

import java.time.Instant;
import java.util.List;

public record PromptListView(Long id, String name, String sourceFilename, Instant createdAt, int itemCount, List<PromptListItemView> items) {
}
