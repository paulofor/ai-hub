ALTER TABLE codex_requests ADD COLUMN IF NOT EXISTS max_model_reasoning_wait_ms BIGINT;
ALTER TABLE codex_requests ADD COLUMN IF NOT EXISTS max_command_execution_wait_ms BIGINT;
ALTER TABLE codex_requests ADD COLUMN IF NOT EXISTS max_external_service_wait_ms BIGINT;
