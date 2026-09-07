#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
migration_root="${1:-${repo_dir}/apps/backend/src/main/resources/db/migration}"
databases=(h2 mysql postgresql)
failed=0

for database in "${databases[@]}"; do
  directory="${migration_root}/${database}"
  if [ ! -d "${directory}" ]; then
    echo "[MIGRATION] Diretório ausente: ${directory}" >&2
    failed=1
    continue
  fi

  declare -A migration_by_version=()
  while IFS= read -r filename; do
    version="${filename#V}"
    version="${version%%__*}"

    if [ -n "${migration_by_version[${version}]+configured}" ]; then
      echo "[MIGRATION] Versão duplicada em ${database}: V${version}" >&2
      echo "[MIGRATION]   ${migration_by_version[${version}]}" >&2
      echo "[MIGRATION]   ${filename}" >&2
      failed=1
      continue
    fi

    migration_by_version["${version}"]="${filename}"
  done < <(find "${directory}" -maxdepth 1 -type f -name 'V*__*.sql' -printf '%f\n' | sort -V)
  unset migration_by_version
done

if [ "${failed}" -ne 0 ]; then
  exit 1
fi

echo 'Versões Flyway únicas em H2, MySQL e PostgreSQL.'
