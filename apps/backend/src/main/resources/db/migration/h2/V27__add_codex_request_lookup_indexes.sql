CREATE INDEX IF NOT EXISTS idx_codex_requests_external_id ON codex_requests(external_id);
CREATE INDEX IF NOT EXISTS idx_codex_requests_rating_created_at ON codex_requests(rating, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_codex_interactions_request_sequence_id ON codex_interactions(codex_request_id, sequence, id);
