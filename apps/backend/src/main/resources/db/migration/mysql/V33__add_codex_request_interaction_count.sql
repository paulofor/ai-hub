ALTER TABLE codex_requests
    ADD COLUMN interaction_count INT NULL;

UPDATE codex_requests
SET interaction_count = (
    SELECT total_interactions
    FROM (
        SELECT codex_requests.id AS request_id, COUNT(codex_interactions.id) AS total_interactions
        FROM codex_requests
        LEFT JOIN codex_interactions ON codex_interactions.codex_request_id = codex_requests.id
        GROUP BY codex_requests.id
    ) interaction_counts
    WHERE interaction_counts.request_id = codex_requests.id
)
WHERE interaction_count IS NULL;
