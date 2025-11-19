package com.aihub.hub.service;

public record RepoCoordinates(String owner, String repo) {

    public static RepoCoordinates from(String environment) {
        if (environment == null || environment.isBlank()) {
            return null;
        }
        String[] parts = environment.trim().split("/");
        if (parts.length < 2) {
            return null;
        }
        return new RepoCoordinates(parts[0], parts[1]);
    }
}
