# Sandbox orchestration flow

O fluxo de automação agora centraliza a execução das correções no `sandbox-orchestrator`, mantendo o backend livre de chamadas diretas à OpenAI.

1. **Frontend → Backend**
   - O usuário descreve a tarefa para um repositório (ex.: investigar falha de pipeline, corrigir testes) e informa o run/branch relevante.
   - O frontend envia a requisição para o backend (`POST /api/cifix/jobs`), incluindo dados do repositório, branch/commit e comandos de teste opcionais.

2. **Backend → Sandbox-orchestrator**
   - O backend resolve metadados do repositório e cria um registro de job (tabela `cifix_jobs`).
   - Em seguida envia o payload para o sandbox-orchestrator (`POST /jobs`) com `jobId`, `repoUrl`, `branch`, `task` e `testCommand`.
   - Consultas posteriores usam `GET /jobs/{id}` com `refresh=true` para sincronizar status e resultados.

3. **Sandbox-orchestrator → Sandbox**
   - Para cada job é criado um diretório temporário exclusivo e o repositório é clonado na branch/commit solicitado.
   - O serviço expõe tools controladas ao modelo (`run_shell`, `read_file`, `write_file`) e dispara o loop de tool-calling no modelo `gpt-5-codex` via Responses API.
   - Cada tool call é executada no sandbox (execução de comandos, leitura/escrita de arquivos) e o resultado é retornado ao modelo até o término da iteração.

4. **Sandbox-orchestrator → Backend**
   - Ao finalizar, o orquestrador registra no job: status (`COMPLETED`/`FAILED`), resumo textual, arquivos alterados e patch unificado.
   - O backend sincroniza esses dados no registro interno (`/api/cifix/jobs/{id}?refresh=true`) e os expõe ao frontend.

5. **Backend → Frontend**
   - O frontend exibe o status do job, resumo gerado e lista de arquivos modificados; quando disponível, pode apresentar o patch proposto.

## Endpoints relevantes

- **Backend**
  - `POST /api/cifix/jobs`: cria um job de análise/correção para um repositório.
  - `GET /api/cifix/jobs/{jobId}`: retorna o status salvo; use `?refresh=true` para consultar o sandbox-orchestrator.

- **Sandbox-orchestrator**
  - `POST /jobs`: inicia um job no sandbox (clona repo, prepara tools e inicia o loop com o modelo).
  - `GET /jobs/{id}`: retorna o status atual, resumo e patch quando disponíveis.

## Ferramentas disponíveis no sandbox

- O contêiner do sandbox agora inclui o utilitário `apply_patch` (wrapper para `patch`/`gpatch`) em `/usr/local/bin`. Ele aceita patches com o marcador `*** Begin Patch` ou diffs tradicionais, permitindo edições segmentadas sem reescrever arquivos completos.
- O pacote `jq` vem pré-instalado para inspeção, transformação e validação de payloads JSON durante análises, automações e chamadas HTTP feitas dentro da sandbox.
- O `ffprobe` vem pré-instalado pelo pacote `ffmpeg` para inspecionar metadados, codecs, resolução, duração, streams e integridade básica de arquivos de vídeo dentro das sandboxes Codex ChatGPT.
- O contêiner do sandbox também inclui Playwright, `@playwright/test` e `chromium` do Debian. A imagem instala os pacotes Node com `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, exporta `NODE_PATH=/usr/local/lib/node_modules` e aponta `CHROME_BIN`, `CHROMIUM_BIN`, `PUPPETEER_EXECUTABLE_PATH` e `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` para `/usr/bin/chromium`, permitindo que agentes usem `playwright`, `require('playwright')` ou `@playwright/test` para validar alterações visuais e gerar screenshots automatizados. O prompt inicial do runner informa explicitamente essa capacidade ao modelo e orienta o uso do navegador em tarefas de UI/layout/mudança visual.
- Para fechar o ciclo visual, o runner expõe as tools `read_image` e `fetch_image`: `read_image` carrega PNG/JPG/WebP/GIF locais do sandbox e `fetch_image` baixa imagens públicas externas, validando formato/tamanho antes de reenviar o conteúdo ao próximo turno como `input_image` multimodal. O limite padrão por imagem é 5 MiB e pode ser ajustado por `IMAGE_TOOL_MAX_BYTES`.
- O Docker CLI e o plugin Docker Compose v2 vêm pré-instalados para permitir workflows que dependem de contêineres; use `docker compose` em vez do binário legado `docker-compose`. O uso real de containers ainda depende de expor o socket do host ou configurar uma engine acessível via rede.
- O AWS CLI vem pré-instalado para permitir que o modelo execute verificações e operações AWS quando o ambiente fornecer credenciais e permissões adequadas. Em Docker Compose, o diretório do host `${AWS_CREDENTIALS_HOST_DIR:-/root/infra/aws}` é montado como `/run/secrets/aws:ro`; quando o arquivo `acesso_aws` existe nesse diretório, o startup do `sandbox-orchestrator` exporta `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` e `AWS_SESSION_TOKEN` opcional para o runner e para o Codex App Server.
- As credenciais Luma, Kling e HeyGen podem ser fornecidas por arquivos fora do repositório em `${LUMA_TOKEN_HOST_DIR:-/root/infra/luma-token}/luma_api_key`, `${KLING_TOKEN_HOST_DIR:-/root/infra/kling-token}/kling_api_key` e `${HEYGEN_TOKEN_HOST_DIR:-/root/infra/heygen-token}/heygen_api_key`. O `docker-compose` monta esses diretórios em `/run/secrets/luma-token:ro`, `/run/secrets/kling-token:ro` e `/run/secrets/heygen-token:ro` e exporta `LUMA_API_KEY`, `KLING_API_KEY` e `HEYGEN_API_KEY` para o runner e para o Codex App Server quando os arquivos existem, sem versionar os segredos.
- O GitHub CLI (`gh`) e o `actionlint` vêm pré-instalados para inspecionar repositórios, issues, pull requests e workflows quando houver autenticação GitHub disponível, além de validar arquivos `.github/workflows/*.yml`/`.yaml` antes de concluir ajustes em GitHub Actions.
- A stack também inclui um capturador de e-mail interno (`sandbox-mail`, Mailpit) para testes de SMTP. O `sandbox-orchestrator` recebe `SANDBOX_SMTP_HOST`, `SANDBOX_SMTP_PORT`, `SANDBOX_MAIL_WEB_URL` e `SANDBOX_MAIL_API_URL`; o perfil `CHATGPT_CODEX_MKT` informa esses endpoints ao modelo para validar fluxos de e-mail sem credenciais reais.
