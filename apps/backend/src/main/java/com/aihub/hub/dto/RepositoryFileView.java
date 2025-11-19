package com.aihub.hub.dto;

public record RepositoryFileView(String path,
                                 String ref,
                                 String sha,
                                 long size,
                                 String content) {
}
