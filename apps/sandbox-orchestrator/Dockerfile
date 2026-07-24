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
  && apt-get install -y --no-install-recommends git gh python3 python3-pip patch jq ffmpeg temurin-21-jdk maven ripgrep docker-ce-cli docker-compose-plugin bash google-cloud-cli awscli chromium \
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
RUN cat <<'EOF' >/usr/local/bin/sandbox-media-player
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const usage = `Uso: sandbox-media-player <arquivo-video-ou-audio> [saida.html]

Gera uma pagina HTML local com player nativo para validar video/audio na sandbox.
Abra a pagina gerada com Chromium/Playwright, por exemplo:
  chromium --headless --screenshot=media-player.png file:///caminho/saida.html
`;

const input = process.argv[2];
if (!input || input === '-h' || input === '--help') {
  console.log(usage);
  process.exit(input ? 0 : 1);
}

const mediaPath = path.resolve(input);
if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
  console.error(`Arquivo de midia nao encontrado: ${mediaPath}`);
  process.exit(2);
}

const ext = path.extname(mediaPath).toLowerCase();
const mimeByExt = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
};
const mimeType = mimeByExt[ext] || 'application/octet-stream';
const isAudio = mimeType.startsWith('audio/');
const outputPath = path.resolve(process.argv[3] || `${mediaPath}.player.html`);
const title = path.basename(mediaPath);
const mediaUrl = pathToFileURL(mediaPath).href;
const mediaTag = isAudio
  ? `<audio id="media" controls preload="metadata" src="${mediaUrl}"></audio>`
  : `<video id="media" controls preload="metadata" playsinline src="${mediaUrl}"></video>`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sandbox media player - ${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Arial, sans-serif; }
    body { margin: 0; background: #101418; color: #f6f7f9; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    .stage { background: #05070a; border: 1px solid #29313a; border-radius: 8px; padding: 16px; }
    video, audio { width: 100%; max-height: 72vh; display: block; background: #000; }
    audio { margin: 48px 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; margin: 16px 0 0; }
    dt { color: #a9b4c0; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .hint { color: #c5ced8; margin-top: 14px; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <section class="stage">
      ${mediaTag}
      <dl>
        <dt>Arquivo</dt><dd>${escapeHtml(mediaPath)}</dd>
        <dt>MIME</dt><dd>${escapeHtml(mimeType)}</dd>
        <dt>Duração</dt><dd id="duration">carregando</dd>
        <dt>Resolução</dt><dd id="resolution">${isAudio ? 'audio' : 'carregando'}</dd>
        <dt>Tempo atual</dt><dd id="currentTime">0.000s</dd>
        <dt>Status</dt><dd id="status">aguardando metadados</dd>
      </dl>
      <p class="hint">Use este player junto com ffprobe para avaliar naturalidade da pronuncia, sincronizacao labial, cortes e qualidade tecnica.</p>
    </section>
  </main>
  <script>
    const media = document.getElementById('media');
    const duration = document.getElementById('duration');
    const resolution = document.getElementById('resolution');
    const currentTime = document.getElementById('currentTime');
    const status = document.getElementById('status');
    const fmt = (value) => Number.isFinite(value) ? value.toFixed(3) + 's' : 'indisponivel';
    media.addEventListener('loadedmetadata', () => {
      duration.textContent = fmt(media.duration);
      if ('videoWidth' in media && media.videoWidth) {
        resolution.textContent = media.videoWidth + 'x' + media.videoHeight;
      }
      status.textContent = 'metadados carregados';
    });
    media.addEventListener('timeupdate', () => { currentTime.textContent = fmt(media.currentTime); });
    media.addEventListener('play', () => { status.textContent = 'reproduzindo'; });
    media.addEventListener('pause', () => { status.textContent = 'pausado'; });
    media.addEventListener('ended', () => { status.textContent = 'finalizado'; });
    media.addEventListener('error', () => { status.textContent = 'erro ao carregar midia'; });
  </script>
</body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(outputPath);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
EOF
RUN chmod +x /usr/local/bin/sandbox-media-player
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
