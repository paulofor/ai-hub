#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="${repository_root}/apps/sandbox-orchestrator/scripts/sandbox-remote-docker"
fake_ssh="${repository_root}/apps/sandbox-orchestrator/tests/fixtures/fake-sandbox-ssh"
mismatch_ssh="${repository_root}/apps/sandbox-orchestrator/tests/fixtures/fake-sandbox-ssh-mismatched-id"
compose_file="${repository_root}/apps/sandbox-orchestrator/tests/remote-docker-compose.yml"
project="${SANDBOX_REMOTE_DOCKER_TEST_PROJECT:?Defina SANDBOX_REMOTE_DOCKER_TEST_PROJECT}"
destination=root@fixture.test
session=remote-e2e
other_session=remote-other
artifact=probe:test
base_image=aihubsbx/fixture/base:test
session_image="aihubsbx/${session}/${artifact}"
other_image="aihubsbx/${other_session}/${artifact}"
container="aihubsbx-${session}-app"
other_container="aihubsbx-${other_session}-app"
unmanaged_container="aihubsbx-${session}-unmanaged"

export SANDBOX_REMOTE_DOCKER_FIXTURE_IMAGE="${base_image}"

cleanup() {
  SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" cleanup "${destination}" "${session}" >/dev/null 2>&1 || true
  SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" cleanup "${destination}" "${other_session}" >/dev/null 2>&1 || true
  docker container rm --force "${unmanaged_container}" >/dev/null 2>&1 || true
  docker image rm "${session_image}" "${other_image}" "${base_image}" >/dev/null 2>&1 || true
  docker compose -p "${project}" -f "${compose_file}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker version >/dev/null
docker compose version >/dev/null
docker compose -p "${project}" -f "${compose_file}" build fixture-image >/dev/null
docker image tag "${base_image}" "${session_image}"
docker image tag "${base_image}" "${other_image}"

if SANDBOX_SSH_COMMAND="${mismatch_ssh}" "${helper}" push \
  "${destination}" "${session}" "${session_image}" "${artifact}" >/dev/null 2>&1; then
  echo 'o helper aceitou digest canônico divergente' >&2
  exit 1
fi

SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" push \
  "${destination}" "${session}" "${session_image}" "${artifact}" >/dev/null
SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" push \
  "${destination}" "${other_session}" "${other_image}" "${artifact}" >/dev/null

if SANDBOX_SSH_COMMAND=/arquivo/inexistente "${helper}" inspect \
  "${destination}" 'Sessao Invalida' app >/dev/null 2>&1; then
  echo 'o helper abriu dependência antes de rejeitar a sessão inválida' >&2
  exit 1
fi

if SANDBOX_SSH_COMMAND="${fake_ssh}" SANDBOX_REMOTE_DOCKER_NETWORK=host "${helper}" run \
  "${destination}" "${session}" app "${artifact}" >/dev/null 2>&1; then
  echo 'o helper aceitou host network' >&2
  exit 1
fi

SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" run \
  "${destination}" "${session}" app "${artifact}" >/dev/null
SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" run \
  "${destination}" "${other_session}" app "${artifact}" >/dev/null

if SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" run \
  "${destination}" "${session}" app "${artifact}" >/dev/null 2>&1; then
  echo 'o helper sobrescreveu um container existente' >&2
  exit 1
fi

docker container run --detach \
  --name "${unmanaged_container}" \
  --network none \
  --memory 64m \
  --pids-limit 32 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  "${base_image}" >/dev/null

if SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" inspect \
  "${destination}" "${session}" unmanaged >/dev/null 2>&1; then
  echo 'o helper aceitou container sem labels de gerenciamento' >&2
  exit 1
fi

SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" exec \
  "${destination}" "${session}" app sh -c 'printf exec-ok' | grep -qx exec-ok
SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" logs \
  "${destination}" "${session}" app 20 | grep -q fixture-ready

metadata="$(SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" inspect \
  "${destination}" "${session}" app)"
jq -e '
  length == 1
  and .[0].Config.Labels["aihub.sandbox.managed"] == "true"
  and .[0].Config.Labels["aihub.sandbox.session"] == "remote-e2e"
  and .[0].HostConfig.Memory == 1073741824
  and .[0].HostConfig.NanoCpus == 1000000000
  and .[0].HostConfig.PidsLimit == 256
  and .[0].HostConfig.NetworkMode == "none"
  and .[0].HostConfig.RestartPolicy.Name == "no"
  and (. [0].HostConfig.CapDrop | index("ALL") != null)
  and (. [0].HostConfig.SecurityOpt | index("no-new-privileges:true") != null)
' <<< "${metadata}" >/dev/null

SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" cleanup \
  "${destination}" "${session}" >/dev/null

if docker container inspect "${container}" >/dev/null 2>&1; then
  echo 'cleanup preservou container da sessão-alvo' >&2
  exit 1
fi
if docker image inspect "${session_image}" >/dev/null 2>&1; then
  echo 'cleanup preservou imagem da sessão-alvo' >&2
  exit 1
fi
docker container inspect "${other_container}" "${unmanaged_container}" >/dev/null
docker image inspect "${other_image}" "${base_image}" >/dev/null

SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" cleanup \
  "${destination}" "${session}" >/dev/null
docker container rm --force "${unmanaged_container}" >/dev/null
SANDBOX_SSH_COMMAND="${fake_ssh}" "${helper}" cleanup \
  "${destination}" "${other_session}" >/dev/null

if docker container ls --all --quiet --filter "name=^/aihubsbx-(remote-e2e|remote-other)-" | grep -q .; then
  echo 'restaram containers gerenciados do ensaio' >&2
  exit 1
fi
if docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^aihubsbx/(remote-e2e|remote-other)/' >/dev/null; then
  echo 'restaram tags gerenciadas do ensaio' >&2
  exit 1
fi

echo 'sandbox-remote-docker e2e: ok'
