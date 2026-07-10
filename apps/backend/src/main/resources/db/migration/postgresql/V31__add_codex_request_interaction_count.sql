ALTER TABLE codex_requests
    ADD COLUMN interaction_count INTEGER;

UPDATE codex_requests
SET interaction_count = (
    SELECT COUNT(*)
    FROM codex_interactions
    WHERE codex_interactions.codex_request_id = codex_requests.id
)
WHERE interaction_count IS NULL;
