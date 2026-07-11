CREATE TABLE codex_saved_conversations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    environment VARCHAR(255) NULL,
    model VARCHAR(255) NULL,
    profile VARCHAR(64) NOT NULL,
    messages_json LONGTEXT NOT NULL,
    message_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_codex_saved_conversations_profile_updated ON codex_saved_conversations(profile, updated_at);
