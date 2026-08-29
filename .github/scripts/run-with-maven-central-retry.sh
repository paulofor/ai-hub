#!/usr/bin/env bash
set -uo pipefail

max_attempts="${MAVEN_CENTRAL_MAX_ATTEMPTS:-4}"
base_delay_seconds="${MAVEN_CENTRAL_RETRY_DELAY_SECONDS:-15}"
attempt=1
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

while true; do
  : > "$log_file"
  set +e
  "$@" 2>&1 | tee "$log_file"
  command_status="${PIPESTATUS[0]}"
  set -e

  if (( command_status == 0 )); then
    exit 0
  fi

  if ! grep -Eqi '(^|[^0-9])429([^0-9]|$)|Too Many Requests' "$log_file"; then
    exit "$command_status"
  fi

  if (( attempt >= max_attempts )); then
    echo "Maven Central continuou respondendo com HTTP 429 após ${attempt} tentativas." >&2
    exit "$command_status"
  fi

  delay_seconds=$((base_delay_seconds * (2 ** (attempt - 1))))
  echo "Maven Central respondeu com HTTP 429; nova tentativa em ${delay_seconds}s (${attempt}/${max_attempts})." >&2
  sleep "$delay_seconds"
  attempt=$((attempt + 1))
done
