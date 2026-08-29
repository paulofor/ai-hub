#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
compose_file="${repo_dir}/apps/backend/tests/public-proxy-recovery-migrations/docker-compose.yml"
mysql_migration="${repo_dir}/apps/backend/src/main/resources/db/migration/mysql/V44__create_public_proxy_recoveries.sql"
postgres_migration="${repo_dir}/apps/backend/src/main/resources/db/migration/postgresql/V44__create_public_proxy_recoveries.sql"
project="${PUBLIC_PROXY_MIGRATIONS_COMPOSE_PROJECT:-ai-hub-public-proxy-migrations-test}"

compose() {
  docker compose -p "${project}" -f "${compose_file}" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
compose up -d --wait --wait-timeout 120

compose exec -T -e MYSQL_PWD=test-only-root mysql \
  mysql --protocol=TCP -uroot recovery_test < "${mysql_migration}"
compose exec -T -e MYSQL_PWD=test-only-root mysql \
  mysql --protocol=TCP -uroot -Nse \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='recovery_test' AND table_name='public_proxy_recoveries'" \
  | grep -Fxq '1'
compose exec -T -e MYSQL_PWD=test-only-root mysql \
  mysql --protocol=TCP -uroot recovery_test -e \
  "INSERT INTO public_proxy_recoveries (request_id, reason, status, requested_at, updated_at) VALUES ('98c928e4-4729-4512-89ef-198d8d5f446d', 'teste mysql', 'REQUESTED', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));"
if compose exec -T -e MYSQL_PWD=test-only-root mysql \
  mysql --protocol=TCP -uroot recovery_test -e \
  "INSERT INTO public_proxy_recoveries (request_id, reason, status, requested_at, updated_at) VALUES ('98c928e4-4729-4512-89ef-198d8d5f446d', 'duplicado mysql', 'REQUESTED', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));" \
  >/dev/null 2>&1; then
  echo '[MIGRATION] MySQL aceitou request_id duplicado' >&2
  exit 1
fi

compose exec -T postgres psql -v ON_ERROR_STOP=1 -U recovery -d recovery_test \
  < "${postgres_migration}"
compose exec -T postgres psql -At -U recovery -d recovery_test -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='public_proxy_recoveries'" \
  | grep -Fxq '1'
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U recovery -d recovery_test -c \
  "INSERT INTO public_proxy_recoveries (request_id, reason, status, requested_at, updated_at) VALUES ('dd519b1e-a593-4432-8a8f-e76f25b4e912', 'teste postgres', 'REQUESTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);"
if compose exec -T postgres psql -v ON_ERROR_STOP=1 -U recovery -d recovery_test -c \
  "INSERT INTO public_proxy_recoveries (request_id, reason, status, requested_at, updated_at) VALUES ('dd519b1e-a593-4432-8a8f-e76f25b4e912', 'duplicado postgres', 'REQUESTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);" \
  >/dev/null 2>&1; then
  echo '[MIGRATION] PostgreSQL aceitou request_id duplicado' >&2
  exit 1
fi

echo 'Migrações da recuperação validadas em MySQL 5.7 e PostgreSQL.'
