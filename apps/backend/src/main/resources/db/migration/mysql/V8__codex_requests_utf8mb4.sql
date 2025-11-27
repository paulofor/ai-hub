-- Ensure codex requests can store 4-byte UTF-8 characters (e.g., emojis)
ALTER TABLE codex_requests
    CONVERT TO CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
