CREATE TABLE prompt_lists (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(180) NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE prompt_list_items (
    id BIGINT NOT NULL AUTO_INCREMENT,
    prompt_list_id BIGINT NOT NULL,
    position INT NOT NULL,
    prompt LONGTEXT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_prompt_list_items_list FOREIGN KEY (prompt_list_id) REFERENCES prompt_lists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_prompt_list_items_list ON prompt_list_items(prompt_list_id);
