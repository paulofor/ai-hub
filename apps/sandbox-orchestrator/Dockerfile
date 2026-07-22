# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS production
WORKDIR /app
ARG ACTIONLINT_VERSION=1.7.12
ARG PLAYWRIGHT_VERSION=1.54.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/google-cloud.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/google-cloud.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
    | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" \
    > /etc/apt/sources.list.d/adoptium.list \
  && curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
  && echo "deb http://deb.debian.org/debian bookworm-backports main" \
    > /etc/apt/sources.list.d/bookworm-backports.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends git gh python3 python3-pip patch jq temurin-21-jdk maven ripgrep docker-ce-cli docker-compose-plugin bash google-cloud-cli awscli chromium \
  && case "$(dpkg --print-architecture)" in \
    amd64) actionlint_arch=amd64 ;; \
    arm64) actionlint_arch=arm64 ;; \
    *) echo "Arquitetura sem actionlint precompilado: $(dpkg --print-architecture)" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_${actionlint_arch}.tar.gz" \
    | tar -xz -C /usr/local/bin actionlint \
  && chmod +x /usr/local/bin/actionlint \
  && gh --version \
  && actionlint --version \
  && rm -rf /var/lib/apt/lists/* \
  && cat <<'EOF' >/usr/local/bin/apply_patch
#!/bin/sh
set -euo pipefail

TMPFILE=$(mktemp)
cleanup() {
  rm -f "$TMPFILE" "${TMPFILE}.patch"
}
trap cleanup EXIT

cat >"$TMPFILE"

if grep -q '^*** Begin Patch' "$TMPFILE"; then
  sed -n '/^*** Begin Patch/,/^*** End Patch/p' "$TMPFILE" | sed '1d;$d' >"${TMPFILE}.patch"
else
  cp "$TMPFILE" "${TMPFILE}.patch"
fi

PATCH_BIN="$(command -v gpatch || true)"
if [ -z "$PATCH_BIN" ]; then
  PATCH_BIN="$(command -v patch || true)"
fi

if [ -z "$PATCH_BIN" ]; then
  echo 'Nenhum comando patch encontrado no contêiner.' >&2
  exit 1
fi

"$PATCH_BIN" -p0 -u -N --no-backup-if-mismatch <"${TMPFILE}.patch"
EOF
RUN chmod +x /usr/local/bin/apply_patch
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g typescript @openai/codex@0.141.0 playwright@${PLAYWRIGHT_VERSION} @playwright/test@${PLAYWRIGHT_VERSION} \
  && codex --version \
  && playwright --version \
  && mkdir -p /var/lib/ai-hub/codex \
  && chmod 700 /var/lib/ai-hub/codex
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=8083
ENV CODEX_HOME=/var/lib/ai-hub/codex
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMIUM_BIN=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_PATH=/usr/local/lib/node_modules
EXPOSE 8083
CMD ["node", "dist/src/index.js"]
