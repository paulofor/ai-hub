CREATE TABLE public_proxy_recoveries (
    id BIGINT NOT NULL AUTO_INCREMENT,
    request_id VARCHAR(36) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(32) NOT NULL,
    github_run_id BIGINT,
    github_run_url VARCHAR(1000),
    github_conclusion VARCHAR(40),
    requested_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_public_proxy_recoveries_request UNIQUE (request_id),
    KEY idx_public_proxy_recoveries_requested_at (requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
