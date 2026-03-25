CREATE TABLE video_projects (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    product_name VARCHAR(255),
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    language VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    tone VARCHAR(80),
    target_audience VARCHAR(255),
    primary_goal VARCHAR(255),
    call_to_action_url VARCHAR(500),
    avatar_style VARCHAR(100),
    hero_image_url VARCHAR(500),
    owner_email VARCHAR(255),
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE video_scenes (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
    sequence_index INTEGER NOT NULL,
    title VARCHAR(255),
    script TEXT NOT NULL,
    visual_style VARCHAR(100),
    voiceover_url VARCHAR(500),
    duration_seconds INTEGER,
    call_to_action_label VARCHAR(100),
    primary_asset_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_video_scenes_project_sequence UNIQUE (project_id, sequence_index)
);

CREATE TABLE video_assets (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    label VARCHAR(150) NOT NULL,
    source VARCHAR(500) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_video_assets_project_type ON video_assets(project_id, type);

CREATE TABLE video_render_jobs (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
    provider VARCHAR(100) NOT NULL,
    provider_job_id VARCHAR(150),
    status VARCHAR(40) NOT NULL DEFAULT 'queued',
    render_profile VARCHAR(150),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    output_url VARCHAR(500),
    failure_reason TEXT
);
CREATE INDEX idx_video_render_jobs_project ON video_render_jobs(project_id);
