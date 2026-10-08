#!/usr/bin/env bash
set -euo pipefail

fixture_root="$(mktemp -d)"
trap 'rm -rf "${fixture_root}"' EXIT
export npm_config_offline=true npm_config_update_notifier=false

prepare_job() {
  local job_dir="$1"
  mkdir -p "${job_dir}/node_modules/.bin"
  cat >"${job_dir}/package.json" <<'JSON'
{"name":"sandbox-node-smoke-test","private":true,"scripts":{"verify":"node -e \"if (!process.execPath.startsWith('/usr/local/')) process.exit(1)\""}}
JSON
  cat >"${job_dir}/node_modules/.bin/workspace-check" <<'JS'
#!/usr/bin/env node
if (!process.execPath.startsWith('/usr/local/')) process.exit(1);
console.log('Node do job executado pela instalação da imagem');
JS
  chmod +x "${job_dir}/node_modules/.bin/workspace-check"
}

prepare_job "${fixture_root}/job-a"
cd "${fixture_root}/job-a"
sandbox-node-health
npm run --silent verify
npx --offline -- workspace-check
cd "${fixture_root}"
rm -rf "${fixture_root}/job-a"

prepare_job "${fixture_root}/job-b"
cd "${fixture_root}/job-b"
sandbox-node-health
npm run --silent verify
npx --offline -- workspace-check
printf '%s\n' '[NODE] Segundo job validado após remover o workspace anterior.'
