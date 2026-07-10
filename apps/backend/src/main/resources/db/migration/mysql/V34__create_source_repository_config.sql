CREATE TABLE source_repository_config (
    id BIGINT NOT NULL PRIMARY KEY,
    github_owner VARCHAR(150) NOT NULL,
    github_repo VARCHAR(150) NOT NULL,
    github_branch VARCHAR(150) NOT NULL,
    github_token VARCHAR(512) NULL,
    updated_at TIMESTAMP NOT NULL
);
