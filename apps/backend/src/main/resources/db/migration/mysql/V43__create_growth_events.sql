CREATE TABLE growth_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    mission_id BIGINT NOT NULL,
    type VARCHAR(40) NOT NULL,
    source VARCHAR(80) NOT NULL,
    external_id VARCHAR(190) NOT NULL,
    amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    occurred_at DATETIME(6) NOT NULL,
    received_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_growth_events_source_event UNIQUE (source, external_id),
    CONSTRAINT fk_growth_events_mission FOREIGN KEY (mission_id) REFERENCES growth_missions(id),
    KEY idx_growth_events_mission_occurred (mission_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
