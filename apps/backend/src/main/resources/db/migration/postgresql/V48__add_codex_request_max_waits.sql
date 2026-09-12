ALTER TABLE codex_requests ADD COLUMN max_model_reasoning_wait_ms BIGINT;
ALTER TABLE codex_requests ADD COLUMN max_command_execution_wait_ms BIGINT;
ALTER TABLE codex_requests ADD COLUMN max_external_service_wait_ms BIGINT;
