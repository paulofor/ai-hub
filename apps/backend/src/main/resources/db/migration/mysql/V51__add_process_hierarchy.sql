ALTER TABLE processes
    ADD COLUMN parent_process_id BIGINT NULL,
    ADD CONSTRAINT fk_processes_parent
        FOREIGN KEY (parent_process_id) REFERENCES processes (id),
    ADD INDEX idx_processes_parent_process_id (parent_process_id);
