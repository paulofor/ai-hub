#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_dir}"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo '[SHELL] ShellCheck não está disponível no runner.' >&2
  echo '[SHELL] Instale-o na imagem/ambiente da sandbox antes de executar esta validação.' >&2
  exit 127
fi

mapfile -t shell_files < <(
  git grep -Il '^#!.*\(ba\|z\|k\)sh' -- \
    ':!exemplos/codex-rs/vendor/**' \
    ':!**/node_modules/**' \
    ':!**/dist/**' \
    | sort
)

if [ "${#shell_files[@]}" -eq 0 ]; then
  echo '[SHELL] Nenhum script shell versionado foi encontrado.' >&2
  exit 1
fi

printf '%s\n' "[SHELL] Validando ${#shell_files[@]} scripts com bash -n..."
bash -n "${shell_files[@]}"

printf '%s\n' '[SHELL] Executando análise estática com ShellCheck...'
shellcheck -x "${shell_files[@]}"

printf '%s\n' '[SHELL] bash -n e ShellCheck passaram.'
