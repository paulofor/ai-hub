#!/usr/bin/env bash
set -euo pipefail

migration="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/main/resources/db/migration/mysql/V50__create_processes.sql"

rg -q 'created_at TIMESTAMP\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(6\)' "$migration"
rg -q 'updated_at TIMESTAMP\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(6\) ON UPDATE CURRENT_TIMESTAMP\(6\)' "$migration"

if rg -q 'TIMESTAMP\(6\) NOT NULL,' "$migration"; then
  echo 'Coluna TIMESTAMP obrigatória sem default compatível encontrada.' >&2
  exit 1
fi

echo 'Contrato temporal da migration MySQL V50 válido.'
