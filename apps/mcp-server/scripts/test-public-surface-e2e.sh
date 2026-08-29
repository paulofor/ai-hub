#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
compose_file="${repo_dir}/apps/mcp-server/tests/public-surface/docker-compose.yml"
project="${MCP_PUBLIC_SURFACE_COMPOSE_PROJECT:-ai-hub-mcp-public-surface-test}"

compose() {
  docker compose -p "${project}" -f "${compose_file}" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
compose build caddy mcp-server
compose up -d --no-build --wait --wait-timeout 120

probe() {
  compose exec -T probe wget -qO- "$1"
}

probe http://caddy:8080/mcp | grep -Fq '"status":"UP"'
probe http://caddy:8080/mcp/tools/recover-public-proxy/test-request | grep -Fq 'semantic-tool-reached'
probe http://caddy:8080/ | grep -Fq 'frontend-reached'

for path in \
  /mcp/tools/linux-command \
  /mcp/tools/linux-command/ \
  /mcp/tools/linux-command/anything; do
  result="$(compose exec -T probe sh -c \
    "wget -S -O - 'http://caddy:8080${path}' 2>&1 || true" \
    2>&1)"
  printf '%s' "${result}" | grep -Fq 'HTTP/1.1 404'
  if printf '%s' "${result}" | grep -Fq 'shell-upstream-reached'; then
    echo "[BORDA] shell público alcançou o upstream em ${path}" >&2
    exit 1
  fi
done

echo 'Borda Caddy homologada: shell bloqueado e operação semântica encaminhada.'
