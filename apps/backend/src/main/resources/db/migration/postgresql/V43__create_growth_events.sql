CREATE TABLE growth_events (
    id BIGSERIAL PRIMARY KEY,
    mission_id BIGINT NOT NULL REFERENCES growth_missions(id),
    type VARCHAR(40) NOT NULL,
    source VARCHAR(80) NOT NULL,
    external_id VARCHAR(190) NOT NULL,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_growth_events_source_event UNIQUE (source, external_id)
);
CREATE INDEX idx_growth_events_mission_occurred ON growth_events(mission_id, occurred_at);
