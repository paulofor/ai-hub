#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
caddyfile="${repo_dir}/infra/caddy/Caddyfile"
compose_file="${repo_dir}/docker-compose.yml"
interceptor="${repo_dir}/apps/mcp-server/src/main/java/com/aihub/mcpserver/config/BearerTokenInterceptor.java"
recovery_controller="${repo_dir}/apps/mcp-server/src/main/java/com/aihub/mcpserver/controller/PublicProxyRecoveryController.java"

shell_line="$(grep -n '@mcp_linux_command path' "${caddyfile}" | cut -d: -f1)"
generic_line="$(grep -n '@mcp path /mcp/\*' "${caddyfile}" | cut -d: -f1)"
test -n "${shell_line}"
test -n "${generic_line}"
if [ "${shell_line}" -ge "${generic_line}" ]; then
  echo '[ARQUITETURA] bloqueio do shell deve preceder o proxy MCP genérico' >&2
  exit 1
fi
grep -A3 '@mcp_linux_command path' "${caddyfile}" | grep -Fq 'respond 404'
grep -Fq '@mcp_linux_command path /mcp/tools/linux-command*' "${caddyfile}"
if grep -Fq './infra/caddy/Caddyfile:/etc/caddy/Caddyfile' "${compose_file}"; then
  echo '[ARQUITETURA] Caddyfile versionado não pode ser sobrescrito por arquivo remoto fora da imagem' >&2
  exit 1
fi
grep -Fq 'SERVICE_UNAVAILABLE' "${interceptor}"
grep -Fq 'MCP tools are disabled because the bearer token is not configured' "${interceptor}"
grep -Fq '@RequestMapping("/mcp/tools/recover-public-proxy")' "${recovery_controller}"

echo 'Superfície pública do MCP validada: shell bloqueado e tools fail-closed.'
