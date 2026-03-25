CREATE TABLE video_projects (
    id BIGINT NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    product_name VARCHAR(255) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    language VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    tone VARCHAR(80) NULL,
    target_audience VARCHAR(255) NULL,
    primary_goal VARCHAR(255) NULL,
    call_to_action_url VARCHAR(500) NULL,
    avatar_style VARCHAR(100) NULL,
    hero_image_url VARCHAR(500) NULL,
    owner_email VARCHAR(255) NULL,
    last_synced_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_video_projects_code (code)
) ENGINE=InnoDB;

CREATE TABLE video_scenes (
    id BIGINT NOT NULL AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    sequence_index INT NOT NULL,
    title VARCHAR(255) NULL,
    script TEXT NOT NULL,
    visual_style VARCHAR(100) NULL,
    voiceover_url VARCHAR(500) NULL,
    duration_seconds INT NULL,
    call_to_action_label VARCHAR(100) NULL,
    primary_asset_url VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_video_scenes_project FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
    UNIQUE KEY uk_video_scenes_project_sequence (project_id, sequence_index)
) ENGINE=InnoDB;

CREATE TABLE video_assets (
    id BIGINT NOT NULL AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    type VARCHAR(50) NOT NULL,
    label VARCHAR(150) NOT NULL,
    source VARCHAR(500) NOT NULL,
    description VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_video_assets_project FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
    KEY idx_video_assets_project_type (project_id, type)
) ENGINE=InnoDB;

CREATE TABLE video_render_jobs (
    id BIGINT NOT NULL AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    provider VARCHAR(100) NOT NULL,
    provider_job_id VARCHAR(150) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'queued',
    render_profile VARCHAR(150) NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    output_url VARCHAR(500) NULL,
    failure_reason TEXT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_video_render_jobs_project FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
    KEY idx_video_render_jobs_project (project_id)
) ENGINE=InnoDB;
