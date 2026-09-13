#!/usr/bin/env bash
set -euo pipefail

migration="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/main/resources/db/migration/mysql/V50__create_processes.sql"

rg -q 'CREATE TABLE IF NOT EXISTS processes' "$migration"
rg -q 'CREATE TABLE IF NOT EXISTS codex_request_processes' "$migration"
rg -q 'FOREIGN KEY \(request_id\) REFERENCES codex_requests \(id\) ON DELETE CASCADE' "$migration"

if rg -q 'ALTER TABLE codex_requests' "$migration"; then
  echo 'A V50 não pode bloquear/reconstruir codex_requests durante o startup.' >&2
  exit 1
fi

echo 'Migration MySQL V50 é repetível após DDL parcial e não altera codex_requests.'
