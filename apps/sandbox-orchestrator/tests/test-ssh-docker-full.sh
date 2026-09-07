#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${repository_root}"

project="${SANDBOX_SSH_DOCKER_TEST_PROJECT:?Defina SANDBOX_SSH_DOCKER_TEST_PROJECT}"
round_label="${1:-local}"
orchestrator_image=aihubsbx/fixture/orchestrator:test
unit_log="$(mktemp)"
key_dir="$(mktemp -d)"

cleanup_round() {
  SANDBOX_SSH_TEST_IMAGE="${orchestrator_image}" docker compose -p "${project}" \
    -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [ -f "${key_dir}/id_ed25519" ]; then
    shred -u "${key_dir}/id_ed25519"
  fi
  if [ -f "${key_dir}/id_ed25519.pub" ]; then
    shred -u "${key_dir}/id_ed25519.pub"
  fi
  rmdir "${key_dir}" 2>/dev/null || true
  unlink "${unit_log}" 2>/dev/null || true
}
trap cleanup_round EXIT

npm --prefix apps/sandbox-orchestrator test >"${unit_log}" 2>&1
grep -E '^# (tests|pass|fail|skipped)|^1\.\.' "${unit_log}" | tail -n 8

shellcheck \
  apps/sandbox-orchestrator/scripts/sandbox-ssh \
  apps/sandbox-orchestrator/scripts/sandbox-remote-docker \
  apps/sandbox-orchestrator/scripts/start-sandbox-ssh-agent \
  apps/sandbox-orchestrator/scripts/sandbox-ssh-agent-health \
  apps/sandbox-orchestrator/tests/fixtures/fake-sandbox-ssh \
  apps/sandbox-orchestrator/tests/fixtures/fake-sandbox-ssh-mismatched-id \
  apps/sandbox-orchestrator/tests/test-remote-docker-e2e.sh \
  apps/sandbox-orchestrator/tests/test-ssh-docker-full.sh
actionlint -shellcheck= .github/workflows/ci.yml

export SANDBOX_REMOTE_DOCKER_FIXTURE_IMAGE=aihubsbx/fixture/base:test
export SANDBOX_SSH_TEST_IMAGE="${orchestrator_image}"
docker compose -p "${project}" config --quiet
docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/remote-docker-compose.yml config --quiet
docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml config --quiet

SANDBOX_REMOTE_DOCKER_TEST_PROJECT="${project}" \
  apps/sandbox-orchestrator/tests/test-remote-docker-e2e.sh
SANDBOX_ORCHESTRATOR_IMAGE="${orchestrator_image}" \
  docker compose -p "${project}" build sandbox-orchestrator

ssh-keygen -q -t ed25519 -N '' -C "sandbox-ssh-${round_label}" \
  -f "${key_dir}/id_ed25519"
docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  down --volumes --remove-orphans >/dev/null
docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  run --rm --no-deps -T key-seed < "${key_dir}/id_ed25519" >/dev/null
docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  up -d agent >/dev/null

agent_id="$(docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml ps -q agent)"
for attempt in $(seq 1 30); do
  agent_health="$(docker inspect --format '{{.State.Health.Status}}' "${agent_id}")"
  if [ "${agent_health}" = healthy ]; then
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    docker logs "${agent_id}"
    exit 1
  fi
  sleep 1
done

expected_fingerprint="$(ssh-keygen -lf "${key_dir}/id_ed25519.pub" -E sha256 | awk '{print $2}')"
actual_fingerprint="$(docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  run --rm --no-deps -T probe \
  "ssh-add -L | ssh-keygen -lf - -E sha256 | awk 'NR == 1 { print \$2 }'" | tail -n 1)"
test "${actual_fingerprint}" = "${expected_fingerprint}"

docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  run --rm --no-deps -T probe \
  'test ! -e /run/secrets/sandbox-ssh/id_ed25519 && command -v sandbox-ssh >/dev/null && command -v sandbox-remote-docker >/dev/null'
docker inspect "${agent_id}" | jq -e '
  .[0].HostConfig.NetworkMode == "none"
  and .[0].HostConfig.ReadonlyRootfs == true
  and (.[0].HostConfig.CapDrop | index("ALL") != null)
' >/dev/null

docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml restart agent >/dev/null
agent_id="$(docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml ps -q agent)"
for attempt in $(seq 1 30); do
  agent_health="$(docker inspect --format '{{.State.Health.Status}}' "${agent_id}")"
  if [ "${agent_health}" = healthy ]; then
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    docker logs "${agent_id}"
    exit 1
  fi
  sleep 1
done

restart_fingerprint="$(docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  run --rm --no-deps -T probe \
  "ssh-add -L | ssh-keygen -lf - -E sha256 | awk 'NR == 1 { print \$2 }'" | tail -n 1)"
test "${restart_fingerprint}" = "${expected_fingerprint}"

docker compose -p "${project}" \
  -f apps/sandbox-orchestrator/tests/ssh-agent-compose.yml \
  down --volumes --remove-orphans >/dev/null
git diff --check

if rg -n --hidden -g '!node_modules/**' -g '!dist/**' \
  '^-----BEGIN OPENSSH PRIVATE KEY-----$' \
  apps/sandbox-orchestrator docs .github docker-compose.yml; then
  exit 1
fi
test "$(ssh-keygen -lf apps/sandbox-orchestrator/ssh/operator_key.pub \
  -E sha256 | awk '{print $2}')" = \
  'SHA256:NJ2GkGnHsfNjeA9FDUoL+PQLHPCB9JNnysoonLtjvkc'
gh secret list --repo paulofor/ai-hub | awk '
  $1 == "SANDBOX_OPS_SSH_PRIVATE_KEY" { found=1 }
  END { exit found ? 0 : 1 }
'

remaining_containers="$(docker ps -aq \
  --filter label=aihub.sandbox.session=remote-e2e \
  --filter label=aihub.sandbox.managed=true)"
test -z "${remaining_containers}"

echo "rodada completa ${round_label}: 96 testes e matriz Docker/SSH aprovados"
