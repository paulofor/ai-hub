ALTER TABLE processes ADD COLUMN parent_process_id BIGINT;

ALTER TABLE processes
    ADD CONSTRAINT fk_processes_parent
    FOREIGN KEY (parent_process_id) REFERENCES processes (id);

CREATE INDEX idx_processes_parent_process_id ON processes (parent_process_id);
