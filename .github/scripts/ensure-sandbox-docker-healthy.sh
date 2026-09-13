#!/usr/bin/env bash
set -Eeuo pipefail

service="sandbox-docker"
max_attempts="${SANDBOX_DOCKER_HEALTH_ATTEMPTS:-24}"
interval_seconds="${SANDBOX_DOCKER_HEALTH_INTERVAL_SECONDS:-5}"

container_id() {
  docker compose ps -q "${service}"
}

health_status() {
  local id="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}" 2>/dev/null || true
}

wait_until_healthy() {
  local attempt id status
  for attempt in $(seq 1 "${max_attempts}"); do
    id="$(container_id)"
    status="$(health_status "${id}")"
    printf 'sandbox-docker health: %s (attempt %s/%s)\n' "${status:-missing}" "${attempt}" "${max_attempts}"
    if [ "${status}" = "healthy" ]; then
      return 0
    fi
    sleep "${interval_seconds}"
  done
  return 1
}

id="$(container_id)"
status="$(health_status "${id}")"

if [ "${status}" = "healthy" ]; then
  echo "sandbox-docker is already healthy."
  exit 0
fi

# Compose does not restart a running container merely because its health status
# became unhealthy. Recreate only that failed infrastructure service so the
# dependent application containers are not needlessly replaced twice.
if [ -n "${id}" ]; then
  echo "sandbox-docker is ${status:-unavailable}; collecting diagnostics before recovery." >&2
  docker compose logs --tail 120 "${service}" >&2 || true
  docker inspect --format '{{json .State.Health}}' "${id}" >&2 || true
fi

docker compose up -d --force-recreate "${service}"

if ! wait_until_healthy; then
  echo "sandbox-docker did not become healthy after recovery." >&2
  docker compose logs --tail 200 "${service}" >&2 || true
  exit 1
fi

echo "sandbox-docker recovered and is healthy."
