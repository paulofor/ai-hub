-- Keep migration sequence aligned; MySQL version converts codex_requests to utf8mb4.
-- No data change required for H2.
SELECT 1;
