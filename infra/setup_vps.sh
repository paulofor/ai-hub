#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERRO] Este script precisa ser executado como root (use sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

PACKAGE_MANAGER=""
if command -v apt-get >/dev/null 2>&1; then
  PACKAGE_MANAGER="apt"
elif command -v dnf >/dev/null 2>&1; then
  PACKAGE_MANAGER="dnf"
elif command -v yum >/dev/null 2>&1; then
  PACKAGE_MANAGER="yum"
else
  echo "[ERRO] Nenhum gerenciador de pacotes suportado (apt, dnf ou yum) foi encontrado." >&2
  exit 1
fi

UPDATED_ONCE=0
install_packages() {
  if [ "$#" -eq 0 ]; then
    return
  fi
  case "${PACKAGE_MANAGER}" in
    apt)
      if [[ "${UPDATED_ONCE}" -eq 0 ]]; then
        apt-get update
        UPDATED_ONCE=1
      fi
      DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
      ;;
    dnf)
      dnf install -y "$@"
      ;;
    yum)
      yum install -y "$@"
      ;;
  esac
}

log_section() {
  echo
  echo "===================="
  echo "$1"
  echo "===================="
}

ensure_base_packages() {
  log_section "Instalando dependências básicas"
  case "${PACKAGE_MANAGER}" in
    apt)
      install_packages ca-certificates curl git python3
      ;;
    dnf|yum)
      install_packages ca-certificates curl git python3
      ;;
  esac
}

install_docker() {
  log_section "Verificando Docker"
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker não encontrado. Instalando via script oficial..."
    curl -fsSL https://get.docker.com | sh
  else
    echo "Docker já instalado."
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q docker.service; then
    systemctl enable docker >/dev/null 2>&1 || true
    systemctl start docker >/dev/null 2>&1 || true
  fi
}

COMPOSE_CMD=()
ensure_compose() {
  log_section "Verificando Docker Compose"
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    echo "Usando 'docker compose'."
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    echo "Usando 'docker-compose'."
    return
  fi

  echo "Docker Compose não encontrado. Instalando pacote..."
  case "${PACKAGE_MANAGER}" in
    apt)
      install_packages docker-compose-plugin || install_packages docker-compose
      ;;
    dnf)
      install_packages docker-compose-plugin || install_packages docker-compose
      ;;
    yum)
      install_packages docker-compose-plugin || install_packages docker-compose
      ;;
  esac

  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    echo "Usando 'docker compose'."
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    echo "Usando 'docker-compose'."
    return
  fi

  echo "Download direto do binário do Docker Compose..."
  local compose_url="https://github.com/docker/compose/releases/download/v2.24.7/docker-compose-$(uname -s)-$(uname -m)"
  curl -L "${compose_url}" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    echo "Usando 'docker-compose'."
  else
    echo "[ERRO] Falha ao instalar o Docker Compose." >&2
    exit 1
  fi
}

prompt_with_default() {
  local __var="$1"; shift
  local __prompt="$1"; shift
  local __default="${1-}"
  local __value=""
  if [ -n "${__default}" ]; then
    read -r -p "${__prompt} [${__default}]: " __value
  else
    read -r -p "${__prompt}: " __value
  fi
  if [ -z "${__value}" ]; then
    __value="${__default}"
  fi
  printf -v "${__var}" '%s' "${__value}"
}

prompt_secret() {
  local __var="$1"; shift
  local __prompt="$1"; shift
  local __default="${1-}"
  local __value=""
  if [ -n "${__default}" ]; then
    read -r -s -p "${__prompt} [${__default}]: " __value
  else
    read -r -s -p "${__prompt}: " __value
  fi
  echo
  if [ -z "${__value}" ]; then
    __value="${__default}"
  fi
  printf -v "${__var}" '%s' "${__value}"
}

collect_env_values() {
  log_section "Coletando variáveis de ambiente"

  prompt_with_default FRONTEND_HTTP_PORT "Porta externa para o frontend" "80"
  prompt_with_default BACKEND_HTTP_PORT "Porta externa para o backend" "8080"

  local default_public_url="http://localhost:${BACKEND_HTTP_PORT}"
  prompt_with_default HUB_PUBLIC_URL "URL pública da API (ex: https://app.seudominio.com)" "${default_public_url}"

  prompt_with_default VITE_API_BASE_URL "Base da API usada pelo frontend" "/api"

  prompt_with_default OPENAI_MODEL "Modelo da OpenAI" "gpt-5-codex"

  prompt_secret OPENAI_API_KEY "OPENAI_API_KEY (Enter para deixar vazio)"

  cat <<'EOF'

Referência rápida para preencher as credenciais da GitHub App:
  • GitHub → Settings → Developer settings → GitHub Apps → escolha a app (ex.: ai-hub-automations).
  • Aba General → seção About: copie o número "App ID" (ex.: 212632) para GITHUB_APP_ID.
  • Aba General → clique em "Generate a private key" caso ainda não tenha o arquivo .pem.
  • Aba General → seção Webhook: clique em Edit para ver/definir o segredo usado em GITHUB_WEBHOOK_SECRET.
  • Menu lateral → Install App → abra a instalação e pegue o número final da URL (/installations/<id>) para GITHUB_INSTALLATION_ID.

Se ainda não tiver uma homepage própria, use a URL pública da app (https://github.com/settings/apps/<slug>) temporariamente.

EOF

  prompt_with_default GITHUB_APP_ID "GITHUB_APP_ID" ""
  prompt_with_default GITHUB_INSTALLATION_ID "GITHUB_INSTALLATION_ID" ""
  prompt_secret GITHUB_WEBHOOK_SECRET "GITHUB_WEBHOOK_SECRET (Enter para deixar vazio)"
  prompt_with_default GITHUB_ORG_DEFAULT "GITHUB_ORG_DEFAULT (opcional)" ""

  echo
  echo "Configurando banco de dados MySQL provisionado na hospedagem"
  DB_URL="jdbc:mysql://d555d.vps-kinghost.net:3306/lookgendb"
  DB_USER="lookgen_user"
  DB_PASS="LgN!2025@Db#x7tZ"

  echo
  echo "Para o GITHUB_PRIVATE_KEY_PEM você pode informar um caminho para o arquivo .pem."
  echo "Se preferir, cole o valor já com quebras de linha escapadas (\\n)."
  echo "Se acabou de registrar a app e viu a mensagem 'Registration successful! You must generate a private key...',"
  echo "clique em 'Generate a private key' na aba General para baixar o arquivo antes de prosseguir."
  local key_path=""
  read -r -p "Caminho do arquivo .pem (Enter para pular): " key_path
  local key_value=""
  if [ -n "${key_path}" ]; then
    if [ -f "${key_path}" ]; then
      key_value="$(python3 - "$key_path" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text().strip()
print(text.replace('\n', '\\n'))
PY
)"
    else
      echo "[AVISO] Arquivo não encontrado. A variável ficará vazia."
    fi
  fi
  if [ -z "${key_value}" ]; then
    read -r -p "GITHUB_PRIVATE_KEY_PEM (use \\n para quebras de linha, Enter para deixar vazio): " key_value
  fi
  GITHUB_PRIVATE_KEY_PEM="${key_value}"
}

create_env_file() {
  log_section "Gerando arquivo .env"
  local env_file="${REPO_DIR}/.env"
  if [ -f "${env_file}" ]; then
    local backup="${env_file}.backup.$(date +%Y%m%d%H%M%S)"
    cp "${env_file}" "${backup}"
    echo "Backup criado: ${backup}"
  fi

  {
    printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
    printf 'OPENAI_MODEL=%s\n' "${OPENAI_MODEL}"
    printf 'GITHUB_APP_ID=%s\n' "${GITHUB_APP_ID}"
    printf 'GITHUB_PRIVATE_KEY_PEM="%s"\n' "${GITHUB_PRIVATE_KEY_PEM}"
    printf 'GITHUB_INSTALLATION_ID=%s\n' "${GITHUB_INSTALLATION_ID}"
    printf 'GITHUB_WEBHOOK_SECRET=%s\n' "${GITHUB_WEBHOOK_SECRET}"
    printf 'GITHUB_ORG_DEFAULT=%s\n' "${GITHUB_ORG_DEFAULT}"
    printf 'DB_URL=%s\n' "${DB_URL}"
    printf 'DB_USER=%s\n' "${DB_USER}"
    printf 'DB_PASS=%s\n' "${DB_PASS}"
    printf 'HUB_PUBLIC_URL=%s\n' "${HUB_PUBLIC_URL}"
    printf 'VITE_API_BASE_URL=%s\n' "${VITE_API_BASE_URL}"
    printf 'FRONTEND_HTTP_PORT=%s\n' "${FRONTEND_HTTP_PORT}"
    printf 'BACKEND_HTTP_PORT=%s\n' "${BACKEND_HTTP_PORT}"
  } > "${env_file}"

  chmod 600 "${env_file}"
}

bring_up_stack() {
  log_section "Construindo e subindo os contêineres"
  "${COMPOSE_CMD[@]}" down --remove-orphans >/dev/null 2>&1 || true
  "${COMPOSE_CMD[@]}" pull
  "${COMPOSE_CMD[@]}" up --build -d
}

print_summary() {
  cat <<EOF

Configuração concluída! Principais informações:
- Diretório do projeto: ${REPO_DIR}
- Arquivo de variáveis: ${REPO_DIR}/.env
- Frontend publicado na porta: ${FRONTEND_HTTP_PORT}
- Backend publicado na porta: ${BACKEND_HTTP_PORT}
- Banco de dados externo: jdbc:mysql://d555d.vps-kinghost.net:3306/lookgendb

Use "${COMPOSE_CMD[*]} logs -f" para acompanhar os serviços.

EOF
}

ensure_base_packages
install_docker
ensure_compose
collect_env_values
create_env_file
bring_up_stack
print_summary
