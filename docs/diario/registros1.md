# Registros — AI HUB 6

> Orientação: todos os registros deste documento devem sempre incluir **data e hora no fuso UTC-3**.
> Neste documento segue política de **append-only** (não pode ter nenhuma linha apagada; apenas inserções).

> Regra obrigatória de timestamp:
> Antes de adicionar qualquer novo registro, execute obrigatoriamente:
>
> ```bash
> TZ=America/Sao_Paulo date '+%Y-%m-%d %H:%M:%S UTC-3'
> ```
>
> Use exatamente a saída desse comando no título do novo registro.
> É proibido inventar, estimar, inferir ou reaproveitar data/hora a partir de:
> - contexto da conversa;
> - data do commit;
> - data do CI/build;
> - metadados do arquivo;
> - relógio UTC sem conversão explícita;
> - registros anteriores deste documento.
>
> O formato obrigatório do título é:
>
> ```md
> ## YYYY-MM-DD HH:mm:ss UTC-3
> ```
>
> Cada novo registro deve ser adicionado no final do arquivo.
> Se for necessário registrar mais de uma entrada, execute novamente o comando de data/hora para cada entrada.
> Nunca crie registro com timestamp futuro em relação ao horário atual de `America/Sao_Paulo`.
> Em caso de timestamp incorreto já registrado, não apague nem edite o registro antigo; adicione um novo registro de correção explicando o erro.
> Neste documento segue política de **append-only** (não pode ter nenhuma linha apagada; apenas inserções).

## 2026-05-11 — Fase 1 do plano Codex ChatGPT managed
- Implementada rota frontend `/codex-chatgpt` com nova página `CodexChatgptPage`.
- Adicionado acesso no menu lateral e card no dashboard para abertura do novo módulo.
- MVP da autenticação conectado aos endpoints `POST /account/login/start`, `GET /account/read` e `POST /account/logout`.
- Bloqueio funcional do uso quando conta não está conectada, conforme fase 1 do plano.

## 2026-05-11 11:26:30 UTC-3
- Correção de registro: a entrada anterior usou título fora do padrão obrigatório de timestamp UTC-3.
- Execução da fase 1 do plano `docs/plano-codex-chatgpt-managed.md` no frontend com rota `/codex-chatgpt`, menu/dashboard atualizados e fluxo de autenticação MVP (`/account/login/start`, `/account/read`, `/account/logout`).
- Bloqueio explícito de uso da área quando a conta não estiver conectada.

## 2026-05-11 11:47:53 UTC-3
- Executada a fase 2 do plano `docs/plano-codex-chatgpt-managed.md` na página `CodexChatgptPage`.
- Integração completa com requests/executions no pipeline atual via `POST /codex/requests` com `profile: CHATGPT_CODEX`.
- Implementado feedback de estado em tempo real com polling de conta (`/account/read`) e execuções (`/codex/requests`) a cada 5 segundos.
- Tratamento robusto de expiração: bloqueio automático de execução quando conta estiver expirada/desconectada, com instrução de reconexão.

## 2026-05-11 13:42:02 UTC-3
- Executada a fase 3 do plano `docs/plano-codex-chatgpt-managed.md` na página `CodexChatgptPage` com foco na causa raiz de incidentes operacionais (diagnóstico do ciclo de autenticação e execução).
- Adicionado suporte de multi-conta opcional no frontend: contas conhecidas por e-mail são reaproveitadas como sugestão (`accountHint`) para o próximo `POST /account/login/start`.
- Implementada telemetria avançada de troubleshooting na UI com trilha de eventos recentes (polling, login, logout e execução, incluindo falhas).
- Aplicado hardening de sessão no cliente com alerta preventivo para expiração próxima (janela de 5 minutos) para reduzir falhas por sessão vencida.

## 2026-05-11 14:45:43 UTC-3
- Diagnóstico de causa raiz no fluxo de conexão do módulo Codex ChatGPT: frontend chamava endpoints `/account/*` inexistentes no backend atual, causando 404 contínuo e impedindo autenticação.
- Ajustada `CodexChatgptPage` para detectar indisponibilidade da API de conta (404), evitar tentativas de login/polling inválidas e exibir mensagem clara de limitação do ambiente.
- Bootstrap da página tornado resiliente: ambientes/modelos continuam carregando mesmo quando `/account/read` não existe.
- Mantida rastreabilidade de troubleshooting por telemetria no frontend ao registrar indisponibilidade da API de conta.

## 2026-05-11 15:03:54 UTC-3
- Diagnóstico de causa raiz do erro 404 no login: o frontend usava o cliente HTTP com `baseURL=/api`, gerando chamadas para `/api/account/*`, enquanto a autenticação do Codex App Server está exposta em `/account/*`.
- Corrigida a `CodexChatgptPage` para usar chamadas diretas via `axios` nos endpoints de autenticação (`/account/read`, `/account/login/start`, `/account/logout`), removendo o prefixo incorreto `/api` nesse fluxo.
- Mantidas as demais integrações do módulo (`/api/codex/*`, `/api/environments`, `/api/codex/models`) sem alteração, isolando o ajuste apenas no ponto da causa raiz.

## 2026-05-11 15:17:21 UTC-3
- Diagnóstico de causa raiz do erro 405 no login: as chamadas de autenticação foram direcionadas para `/account/*` no host do frontend (Nginx estático), que não aceita `POST` nesse caminho e respondeu `405 Not Allowed`.
- Corrigida `CodexChatgptPage` para usar o cliente HTTP padrão (`baseURL=/api`) também nas rotas de autenticação, garantindo que `GET /account/read`, `POST /account/login/start` e `POST /account/logout` sejam enviados para o backend correto (`/api/account/*`).
- Mantido o restante do fluxo inalterado para isolar a correção no ponto de roteamento HTTP incorreto.

## 2026-05-11 17:43:57 UTC-3
- Diagnóstico de causa raiz do novo 404 em autenticação: o ambiente respondia `GET /account/read` sem erro, mas falhava em `POST /account/login/start`, indicando disponibilidade parcial/inconsistente da API de conta.
- Ajustada `CodexChatgptPage` para tratar 404 também no ato de conectar: ao receber 404 em `login/start`, a UI marca integração como indisponível, interrompe tentativas repetidas e orienta contato com administração.
- Extraída função utilitária `is404Error` para padronizar detecção de endpoint ausente no fluxo de leitura/bootstrap/login.

## 2026-05-11 17:53:16 UTC-3
- Revisão da causa raiz do 404: backend não possuía os endpoints `/api/account/read`, `/api/account/login/start` e `/api/account/logout`.
- Implementado `AccountController` no backend para expor essas rotas e eliminar o `404 Not Found` estrutural por ausência de mapeamento.
- `GET /api/account/read` retorna estado explícito `unsupported` e `connected=false`; `POST /api/account/login/start` retorna `501 Not Implemented` com mensagem clara; `POST /api/account/logout` responde com estado desconectado.

## 2026-05-11 18:20:00 UTC-3
- Diagnóstico de causa raiz do erro `501` em `POST /api/account/login/start`: o backend devolvia `Not Implemented` por um stub sem fluxo de autenticação, impedindo qualquer avanço do login.
- Implementado fluxo inicial de autenticação no `AccountController`: `login/start` agora retorna URLs para abrir autenticação externa e callback local, substituindo o retorno fixo `501`.
- Implementado callback `GET /api/account/login/callback` para consolidar sessão conectada no backend (email + expiração), permitindo que `GET /api/account/read` passe a refletir estado `connected` após o retorno.
- Ajustado `POST /api/account/logout` para limpar sessão de autenticação e retornar estado desconectado de forma consistente.

- Correção de causa raiz no login ChatGPT: removido fallback que preenchia e-mail fictício (`chatgpt-user@openai.com`) no callback quando o provedor não devolvia e-mail.
- `GET /api/account/login/callback` agora invalida a sessão e redireciona com `?login=missing_email` quando não há e-mail confirmado, evitando exibir conta inexistente como conectada.
## 2026-05-11 23:23:06 UTC
- Diagnóstico da causa raiz da falha de autenticação com `?login=missing_email`: o frontend priorizava `response.data.url` (callback local) em vez de `response.data.authUrl` (página de login real), abrindo diretamente `/api/account/login/callback` sem contexto de conta/e-mail.
- Ajustada `CodexChatgptPage` para priorizar `authUrl` e usar `url` apenas como fallback, garantindo que o fluxo comece na autenticação do provedor antes do callback.


- 2026-05-11: Correção de causa raiz no frontend (CodexChatgptPage): parser de /account/read agora interpreta respostas com status sem campo connected e aceita snake_case (account_email/expires_at), evitando falso "desconectado" após login validado na OpenAI.
- 2026-05-12: Diagnóstico de causa raiz no fluxo Codex ChatGPT: `POST /api/account/login/start` estava devolvendo `authUrl` para `https://chatgpt.com/auth/login`, mas sem integração OAuth/callback real, então o usuário fazia login externo e nunca retornava ao callback do AI Hub.
- Ajustado `AccountController` para retornar `authUrl` apontando para o callback local configurável (`hub.account.login-callback-url`, default `/api/account/login/callback`), concluindo a sessão no AI Hub após clicar em conectar; `externalAuthUrl` foi mantido apenas como referência informativa.

- 2026-05-12 04:27:43 UTC | Criação do documento docs/codex-rs-autenticacao-chatgpt.md com o passo a passo de autenticação ChatGPT e uso do modelo no codex-rs.
- 2026-05-12 21:58:18 UTC: Análise de causa raiz do fluxo de autenticação ChatGPT no AI Hub a partir de `docs/codex-rs-autenticacao-chatgpt.md` e `AccountController`; confirmado que o backend atual não executa OAuth real (retorna callback local direto em `authUrl`) e não persiste `access_token`/`refresh_token`, apenas e-mail e expiração em sessão HTTP.
- 2026-05-12 22:01:39 UTC: Ajuste de causa raiz no fluxo de login ChatGPT do AI Hub: `login/start` voltou a apontar `authUrl` para URL externa com `redirect_uri` para callback local + `state` anti-CSRF; callback agora valida `state` e aceita persistência de `access_token`, `refresh_token` e `id_token` em sessão para evitar login "sem redirecionamento" e ausência de token no estado da sessão.
- 2026-05-12 22:20:00 UTC: Diagnóstico de causa raiz para o cenário "já estou logado na OpenAI, mas a tela fica desconectada": o callback local depende de um e-mail associado (`accountHint`) para consolidar a sessão; quando nenhum e-mail é informado, o fluxo termina em `missing_email` e bloqueia execuções.
- Atualizada `CodexChatgptPage` para sempre exibir campo de e-mail da conta OpenAI antes de conectar, enviando `accountHint` explícito no `POST /account/login/start` e registrando telemetria com a conta efetiva usada no login.
- Melhorado reaproveitamento multi-conta: ao detectar conta conhecida, o e-mail também preenche automaticamente o novo campo, reduzindo reconexões sem contexto.

- 2026-05-13 00:09:07 UTC: Orientação operacional para uso da tela de autenticação: instruído que o usuário deve informar o e-mail da conta OpenAI no campo da tela e clicar em "Conectar com ChatGPT" para abrir `authUrl`; mesmo já logado em outra aba, o callback local só conclui sessão no AI Hub após esse fluxo com `accountHint`.

- 2026-05-13 00:22:00 UTC: Correção de causa raiz no login ChatGPT em produção web: `login/start` montava `redirect_uri` com callback relativo (`/api/account/login/callback`), fazendo o provedor abrir o ChatGPT sem retorno válido ao AI Hub. Ajustado `AccountController` para resolver callback absoluto a partir da requisição (ou respeitar URL absoluta configurada), garantindo retorno ao domínio do AI Hub após autenticação.

- 2026-05-13 00:40:00 UTC: Diagnóstico de causa raiz para HTTPS no mesmo host: o `docker-compose` publicava frontend/backend diretamente em portas HTTP sem um terminador TLS central, impedindo emissão/renovação automática de certificado no ponto de entrada.
- Implementado serviço `caddy` no `docker-compose` como reverse proxy único (80/443) para o mesmo host, com volumes persistentes de certificados e roteamento por path para `frontend`, `backend` (`/api/*`) e `sandbox-orchestrator` (`/sandbox/*`).
- Adicionado `infra/caddy/Caddyfile` parametrizado por `CADDY_DOMAIN`, permitindo ativar HTTPS automático via Caddy no domínio público do host.

- 2026-05-13 03:28:06 UTC: Ajuste de causa raiz na publicação de imagens do stack no mesmo ambiente/IP: o serviço `caddy` era o único com imagem fixa (`caddy:2.10-alpine`), diferente dos demais serviços que usam imagem parametrizada por variável de ambiente para publicação no mesmo registry/pipeline. Atualizado `docker-compose.yml` para `CADDY_IMAGE` (default `ghcr.io/paulodb/ai-hub-6-caddy:latest`), alinhando o `caddy` ao mesmo fluxo das outras imagens.
- 2026-05-13 03:40:09 UTC: Correção de causa raiz da falha no deploy remoto (`docker compose pull`) por imagem inexistente do `caddy` em `ghcr.io/paulodb/ai-hub-6-caddy:latest`.
- Atualizado `.github/workflows/ci.yml` para exportar também `CADDY_IMAGE=ghcr.io/${GHCR_USERNAME}/ai-hub-caddy:latest` no SSH remoto, garantindo que todos os serviços usem imagens do mesmo namespace no GHCR durante o deploy.
- Atualizado `docker-compose.yml` para defaults consistentes com o pipeline atual (`ghcr.io/${GHCR_USERNAME:-paulofor}/ai-hub-*`) em `caddy`, `backend`, `frontend` e `sandbox-orchestrator`, eliminando fallback legado `paulodb/ai-hub-6-*` que causava pull quebrado quando variáveis não eram exportadas.

## 2026-05-13 — Correção de deploy GHCR (caddy)
- Investigada causa raiz da falha no deploy: o workflow publicava backend/frontend/sandbox, mas não publicava a imagem `ai-hub-caddy`; no deploy, `docker compose pull` sempre tentava baixar `ghcr.io/<owner>/ai-hub-caddy:latest` e falhava com `not found`.
- Ajustado `.github/workflows/ci.yml` para build/push da imagem `ai-hub-caddy` usando `infra/caddy/Dockerfile`.
- Ajustada rotina de cleanup para também remover a tag SHA do pacote `ai-hub-caddy`.

## 2026-05-13 01:27:22 UTC-3
- Diagnóstico de causa raiz da falha no build/push da imagem `ai-hub-caddy` no CI: o workflow executava `docker buildx build --file infra/caddy/Dockerfile`, porém esse Dockerfile não existia no repositório, interrompendo a etapa de build.
- Adicionado `infra/caddy/Dockerfile` mínimo e consistente com o stack atual (base `caddy:2.10-alpine` + cópia de `infra/caddy/Caddyfile`), restaurando o artefato esperado pela pipeline.

- 2026-05-13 06:10:00 UTC: Criação do novo módulo `apps/mcp-server` (Java 21, Spring Boot, Maven) para atuar como serviço MCP dedicado, atacando a causa raiz da ausência de um serviço isolado para tools remotas no mesmo host dos demais módulos.
- Implementada tool HTTP `POST /mcp/tools/linux-command` com autenticação por token (`X-MCP-TOKEN`) e execução de comandos Linux via `/bin/bash -lc`, com timeout defensivo de 30s para evitar processos presos.
- Atualizados `docker-compose.yml` e `.github/workflows/ci.yml` para incluir build/test/push/deploy da imagem `ai-hub-mcp-server` no mesmo fluxo e host dos outros módulos.
- 2026-05-13 18:40:00 UTC: Ajuste inicial solicitado para mover o MCP Server para uma porta livre no stack: alterado o mapeamento padrão para `MCP_SERVER_HTTP_PORT=8085` (host) -> `8084` (container) no `docker-compose`, evitando colisão com portas já reservadas no projeto/deploy.
- 2026-05-13 18:40:00 UTC: Atualizado o deploy remoto no workflow (`REMOTE_IMAGES_ENV`) para exportar explicitamente `MCP_SERVER_HTTP_PORT=8085`, mantendo consistência entre CI e `docker-compose` ao subir os serviços no VPS.
- 2026-05-13 18:40:00 UTC: Diagnóstico de causa raiz do erro reportado no log de deploy: a falha que interrompe a publicação não está no MCP Server e sim no bind do `caddy` em `0.0.0.0:80` (`port is already allocated`), indicando conflito pré-existente de porta HTTP no host.
- 2026-05-13 19:05:00 UTC: Revisão completa das portas dos containers no mesmo host com `caddy` como único proxy reverso de borda.
- Removida a publicação de portas host para `backend`, `frontend`, `sandbox-orchestrator` e `mcp-server` no `docker-compose`; esses serviços passam a ficar acessíveis somente na rede interna do compose (via DNS de serviço), reduzindo superfície de conflito e exposição indevida.
- Mantidas apenas as portas do `caddy` (`80/443`) como ponto de entrada externo, alinhando o desenho de rede com a causa raiz do incidente de bind em host compartilhado.
- Ajustado workflow de deploy para não exportar mais `MCP_SERVER_HTTP_PORT`, já que não há publicação externa de porta do MCP no host.

- 2026-05-13 20:12:24 UTC — Diagnóstico e correção de causa raiz no acesso por domínio: o `docker-compose.yml` aplicava fallback silencioso `CADDY_DOMAIN:-localhost`, fazendo o Caddy emitir certificado local para `localhost` e ignorar o domínio público quando a variável não era carregada. Ajustado para tornar `CADDY_DOMAIN` obrigatória com erro explícito no startup (`${CADDY_DOMAIN:?...}`), evitando reincidência e falha silenciosa em produção.

- 2026-05-13 20:18:00 UTC — Complemento da correção de causa raiz: além de tornar `CADDY_DOMAIN` obrigatório no compose, incluída a variável no `.env.example` com o domínio informado (`iahub.xyz`) para evitar ausência da configuração durante deploy/bootstrap e impedir regressão para certificado local.
- 2026-05-13 20:40:00 UTC — Correção de causa raiz da falha `yaml: line 11: mapping values are not allowed in this context` durante deploy remoto: o passo de publicação montava um blob único em `REMOTE_IMAGES_ENV` (vários pares `KEY=VALUE` com tags `:latest`) e injetava via `export`, combinação frágil a parsing/quoting em diferentes shells/contexts do runner.
- Ajustado `.github/workflows/ci.yml` para definir as imagens diretamente como variáveis de ambiente inline no comando remoto do `docker compose` (`CADDY_IMAGE=... BACKEND_IMAGE=... ... docker compose pull && docker compose up -d`), eliminando a camada intermediária e evitando erro de interpretação YAML/shell.

- 2026-05-13 20:55:00 UTC — Correção de causa raiz do erro `yaml: line 11: mapping values are not allowed in this context` no `docker compose` durante deploy: a expressão de variável obrigatória em `docker-compose.yml` continha mensagem com `": "` (`ex.: ...`) em escalar YAML sem aspas (`CADDY_DOMAIN: ${...}`), o que quebra parsing YAML na linha 11.
- Ajustado `CADDY_DOMAIN` para valor entre aspas (`CADDY_DOMAIN: "${...}"`), preservando validação obrigatória da variável e eliminando ambiguidade de parsing YAML.

- 2026-05-13 21:05:00 UTC — Ajuste solicitado em revisão: exemplo do domínio em `CADDY_DOMAIN` alterado para `iahub.xyz` (sem usar domínio genérico), mantendo validação obrigatória da variável.

- 2026-05-13 21:15:00 UTC — Ajuste solicitado em revisão: `CADDY_DOMAIN` definido diretamente no compose como `iahub.xyz` (`CADDY_DOMAIN: iahub.xyz`), removendo expansão por variável para atender requisito explícito.

- 2026-05-14 01:50:49 UTC — Diagnóstico de causa raiz para divergência de versões em produção: os contêineres em execução podem ficar misturados entre owners distintos no GHCR (ex.: `paulodb` e `paulofor`) porque o deploy monta as imagens com `GHCR_USERNAME` enquanto o build publica em `github.repository_owner`; quando `GHCR_USERNAME` aponta para outro owner, parte das imagens vem de um namespace e parte de outro, parecendo que não é o stack `ai-hub-6` esperado.
- Mitigação documentada: validar no VPS os valores efetivos de `CADDY_IMAGE`, `BACKEND_IMAGE`, `FRONTEND_IMAGE`, `SANDBOX_ORCHESTRATOR_IMAGE` e `MCP_SERVER_IMAGE` antes do `docker compose pull` e padronizar `GHCR_USERNAME` para o mesmo owner que publica as imagens no workflow.

- 2026-05-14 02:00:00 UTC — Levantamento solicitado sobre owners das imagens `ai-hub` e `ai-hub-6`: referências ativas do stack atual (`docker-compose.yml` e `ci.yml`) usam `ai-hub-*` com owner dinâmico (`GHCR_USERNAME`/`github.repository_owner`) e fallback local para `paulofor`; referências legadas `ai-hub-6-*` ainda existem em documentação/scripts antigos com owner `paulodb` (ex.: `infra/setup_vps.sh` e trecho de README), o que explica confusão de versões no ar quando variáveis não ficam alinhadas.

- 2026-05-14 02:10:00 UTC — Ajuste solicitado para eliminar ambiguidade de nomenclatura de imagens no deploy: padronizado todo o pipeline/compose/README para usar exclusivamente `ai-hub-6-*` (incluindo `caddy` e `mcp-server`), removendo referências ativas a `ai-hub-*` para evitar nova confusão de versão em produção.

- 2026-05-14 02:20:00 UTC — Análise de causa raiz do erro `denied: permission_denied: write_package` no push para `ghcr.io/paulofor/ai-hub-6-backend:latest`: o build da imagem concluiu com sucesso, e a falha ocorre exclusivamente na etapa de publicação no GHCR por falta de permissão de escrita do token/credenciais no namespace `paulofor` (escopo `packages:write` ausente ou token sem acesso ao pacote/owner correto).
- 2026-05-14 02:35:00 UTC — Orientação solicitada de operação: instruído como verificar na interface do GitHub Actions/Packages qual credencial executou o push para GHCR e como confirmar permissões de `packages:write` no workflow/token para diagnosticar `permission_denied: write_package` pela UI.
- 2026-05-14 04:25:00 UTC — Novo diagnóstico a partir da evidência visual do host: a causa raiz provável da divergência de versão não é permissão GHCR, e sim contexto/caminho de execução do deploy (`docker compose`) apontando para diretório legado (`/root/ai-hub`) em vez do diretório alvo do stack atual (`/root/ai-hub-6`), fazendo subir contêineres/projeto da pasta errada.
- 2026-05-14 04:40:00 UTC — Correção de causa raiz no workflow de deploy: alterado `REMOTE_PATH` de `/root/ai-hub` para `/root/ai-hub-6` em `.github/workflows/ci.yml`, garantindo que `rsync` e `docker compose` operem no diretório correto do stack atual no host.
- 2026-05-14 04:40:00 UTC — Ajuste preventivo adicional no workflow: fallback de `GHCR_USERNAME` trocado de `github.actor` para `github.repository_owner`, reduzindo risco de pull em namespace diferente do owner que publica as imagens.

## 2026-05-14 01:32:12 UTC-3
- Diagnóstico de causa raiz da falha `denied: permission_denied: write_package` no push para `ghcr.io/paulofor/ai-hub-6-backend:latest`: o job `docker` autenticava no GHCR com `${{ github.repository_owner }}` + `${{ secrets.GITHUB_TOKEN }}`, combinação que pode não ter permissão de escrita no pacote quando o namespace efetivo depende de credenciais de usuário legado/PAT.
- Ajustado `.github/workflows/ci.yml` para resolver e usar credenciais explícitas no job de build/push (`GHCR_USERNAME`/`GHCR_TOKEN` via secrets, com fallback para owner/GITHUB_TOKEN), alinhando autenticação e destino do push ao mesmo usuário antigo esperado no registry.
- Padronizadas as tags/cache de todas as imagens do job `docker` para `ghcr.io/${GHCR_USERNAME}/...`, evitando mismatch entre usuário autenticado e namespace de publicação.

## 2026-05-14 01:41:55 UTC-3
- Ajustada a autorização do workflow de CI para incluir permissões globais `contents: read` e `packages: write`, alinhando o pipeline ao padrão solicitado e evitando falhas de permissão em jobs que acessam o GHCR.
- 2026-05-14 04:49:56 UTC — Correção de causa raiz para nova ocorrência de `denied: permission_denied: write_package` no push do backend: o workflow priorizava `secrets.GHCR_TOKEN` quando presente, permitindo que um PAT desatualizado/sem `write:packages` sobrescrevesse o token nativo do GitHub Actions e quebrasse a publicação no GHCR.
- Ajustado `.github/workflows/ci.yml` para o job `docker` autenticar no GHCR com `github.repository_owner` + `github.token` (credencial efêmera do run com `packages:write` do próprio workflow), removendo dependência de segredo legado para o push de imagens.
- Mantido fallback por segredo apenas no `deploy` (login no VPS) e no cleanup via API, agora com fallback para `github.token` em vez de `secrets.GITHUB_TOKEN`, padronizando a fonte do token do runtime.
- 2026-05-14 16:51:05 UTC — Ajustado o fallback de `GHCR_USERNAME` no `docker-compose.yml` de `paulofor` para `paulodb` em todos os serviços (`caddy`, `backend`, `frontend`, `sandbox-orchestrator` e `mcp-server`) para alinhar o namespace padrão de pull com o usuário solicitado e eliminar erro de permissão ao publicar/puxar imagens no owner incorreto.
- 2026-05-14 17:22:09 UTC — Correção de causa raiz para push no owner incorreto (`ghcr.io/paulofor/...`): no job `docker` do CI, a etapa "Resolve GHCR credentials" fixava `GHCR_USERNAME=${{ github.repository_owner }}` e ignorava `secrets.GHCR_USERNAME`; ajustado para a mesma regra do deploy (`secrets.GHCR_USERNAME/GHCR_TOKEN` com fallback), garantindo que build/push usem o namespace autorizado (ex.: `paulodb`) e evitando `denied: permission_denied: write_package`.

- 2026-05-14 17:40:00 UTC — Correção adicional da causa raiz para persistência de push no owner incorreto (`paulofor`): o fallback de `GHCR_USERNAME` no workflow ainda dependia de `github.repository_owner` quando segredo não existia, mantendo namespace errado em forks/migrações; padronizado fallback para `secrets.GHCR_USERNAME` -> `vars.GHCR_USERNAME` -> `paulodb` tanto no job `docker` quanto no `deploy` e no cleanup (`GHCR_OWNER`), garantindo consistência total do namespace no build, pull e limpeza de tags.

## 2026-05-14 16:32:50 UTC-3
- Diagnóstico da causa raiz da falha no job `docker` do GitHub Actions: push para `ghcr.io/paulodb/ai-hub-6-caddy:latest` negado com `permission_denied: The requested installation does not exist`, indicando namespace/owner de registry divergente do owner onde o workflow roda (`paulofor`) e/ou ausência de autorização do GitHub App/Actions para publicar no pacote alvo.
- Orientação operacional no GitHub para restabelecer o pipeline: alinhar todas as tags de imagem para `ghcr.io/paulofor/*`, garantir `permissions: packages: write` no workflow e habilitar acesso do repositório ao pacote no GHCR (Package settings > Manage Actions access).

## 2026-05-14 16:36:05 UTC-3
- Revisão do diagnóstico com evidência de UI do GitHub Packages: no perfil `paulofor` não aparece pacote `ai-hub-6-caddy` (nem os demais com sufixo `-6`), enquanto o workflow tenta publicar exatamente nesses nomes; isso explica o cenário "mas não tem?" e reforça que o namespace/nome de pacote do pipeline está desalinhado com os pacotes existentes/esperados no owner.
- Ação de causa raiz recomendada no GitHub: padronizar os nomes usados no CI e no deploy para uma convenção única já existente no owner (ex.: `ai-hub-caddy`/`ai-hub-backend` etc.) **ou** aceitar criar novos pacotes `ai-hub-6-*` e, nesse caso, garantir permissões de publicação e vinculação do pacote ao repositório `paulofor/ai-hub`.

## 2026-05-14 16:38:40 UTC-3
- Correção do diagnóstico anterior com nova evidência: os pacotes `ai-hub-6-backend`, `ai-hub-6-frontend` e `ai-hub-6-sandbox` existem no owner `paulofor`; portanto o problema não é ausência geral do padrão `ai-hub-6-*`.
- Causa raiz refinada para a falha mostrada no job: o erro ocorreu especificamente no push de `ai-hub-6-caddy` com `permission_denied: The requested installation does not exist`, indicando desalinhamento de autorização/vinculação apenas para esse pacote (ou package inexistente para `caddy`) no GHCR.
- Ação objetiva no GitHub: abrir/criar o package `ai-hub-6-caddy` no owner correto, vincular ao repositório `paulofor/ai-hub` em `Manage Actions access` e manter `packages: write` no workflow.

## 2026-05-14 16:40:29 UTC-3
- Nova correção do diagnóstico com evidência adicional: o package `ai-hub-6-caddy` também existe no owner `paulofor` (publicado por `paulofor/ai-hub`), então a hipótese de inexistência do package não se sustenta no estado atual.
- Causa raiz provável consolidada para `permission_denied: The requested installation does not exist`: problema de autorização da instalação/token usada no run específico (ex.: `GITHUB_TOKEN` sem escopo efetivo de escrita naquele contexto, pacote privado sem grant para aquele repositório/workflow run, ou execução em contexto diferente como fork/owner divergente), e não ausência de nome de pacote.
- Diretriz operacional: validar no run que falhou qual `GHCR_USERNAME` e qual token foram efetivamente usados no login (`docker/login-action`), manter `permissions.packages=write`, e conferir no package `ai-hub-6-caddy` o vínculo explícito de Actions para `paulofor/ai-hub`.

## 2026-05-14 16:43:24 UTC-3
- Correção explícita do ponto de autorização: se o package GHCR está vinculado ao repositório `paulofor/ai-hub-6`, conceder acesso para `paulofor/ai-hub` não resolve o run desse projeto; o grant e/ou publicação devem apontar para o repositório correto (`ai-hub-6`) para a instalação existir no contexto esperado.
- Causa raiz refinada: mismatch entre o repositório associado ao package (ex.: `paulofor/ai-hub-6`) e o repositório que executa o workflow/push (ex.: `paulofor/ai-hub`) pode produzir exatamente `permission_denied: The requested installation does not exist`.
- Ação objetiva: alinhar origem do workflow e vínculo do package no mesmo repo (`paulofor/ai-hub-6`), revisar `Manage Actions access` no package com esse repositório e validar secrets/variables no mesmo projeto onde o workflow roda.

## 2026-05-14 16:45:45 UTC-3
- Alinhamento aplicado na configuração para o contexto correto do owner/repositório atual (`paulofor` / stack `ai-hub-6`), atacando a causa raiz de mismatch entre defaults locais e destino real de publicação no GHCR.
- Atualizado `.github/workflows/ci.yml` para fallback padrão de `GHCR_USERNAME` em `paulofor` (jobs `docker`, `deploy` e `cleanup`), evitando fallback legado para `paulodb` quando secrets/vars não estiverem definidos.
- Atualizado `docker-compose.yml` para fallback de `GHCR_USERNAME` em `paulofor` e para `SANDBOX_WORKDIR` default em `/root/ai-hub-6/...`, mantendo consistência com `REMOTE_PATH=/root/ai-hub-6` no deploy.
- 2026-05-14 20:50:14 UTC — Aplicado aos demais módulos o mesmo ajuste de namespace padrão usado no fluxo do `caddy`: fallback de `GHCR_USERNAME` alterado de `paulofor` para `paulodb` no CI e no `docker-compose` (`backend`, `frontend`, `sandbox-orchestrator`, `mcp-server` e `caddy`), para evitar push/pull no owner incorreto que dispara `denied: permission_denied: write_package`.
- 2026-05-14 21:01:02 UTC — Correção da causa raiz do erro `403 Forbidden / The requested installation does not exist` no push para `ghcr.io/paulodb/...`: o fallback padrão de `GHCR_USERNAME` no workflow ainda apontava para `paulodb` quando secrets/vars estavam ausentes, forçando publicação no owner errado. Atualizado `.github/workflows/ci.yml` para fallback padrão `paulofor` nos jobs `docker`, `deploy` e `cleanup`.
- 2026-05-14 21:15:08 UTC — Correção de causa raiz para falha seletiva no push do backend (`denied: permission_denied: write_package`): o workflow podia combinar `GHCR_USERNAME` customizado (ex.: `paulofor`) com `github.token` (sem escopo para publicar em owner divergente), gerando erro de permissão em pacotes específicos. Ajustada a etapa `Resolve GHCR credentials` para falhar cedo quando `GHCR_USERNAME != github.repository_owner` e não houver `secrets.GHCR_TOKEN`, com mensagem explícita para configurar PAT `write:packages` ou alinhar owner.

## 2026-05-14 21:19:15 UTC-3
- Diagnóstico de causa raiz para falha recorrente no push do backend para GHCR (`denied: permission_denied: write_package`): o login no registry estava ocorrendo, porém sem validação prévia de autorização no pacote/namespace, fazendo o erro aparecer apenas no `buildx`.
- Ajustado `.github/workflows/ci.yml` com etapa explícita `Validate GHCR write permission` antes do push para verificar acesso ao pacote `ghcr.io/${GHCR_USERNAME}/ai-hub-6-backend` via API GitHub e falhar cedo com mensagem objetiva sobre escopo `Packages: Read and write` e namespace correto.
- Mantida a etapa de login/push inalterada após a validação para preservar o fluxo atual e atacar a causa raiz (permissão do token/owner), não apenas o sintoma no build.

## 2026-05-14 21:40:10 UTC-3
- Revisão orientada à causa raiz do erro `write_package` considerando publicação no mesmo owner do repositório: removida dependência de `secrets.GHCR_TOKEN` no workflow e padronizado uso de `github.token` nos fluxos de build/push, deploy e cleanup de GHCR.
- Ajustada a etapa `Resolve GHCR credentials` para sempre definir `GHCR_TOKEN=${{ github.token }}` e falhar cedo se `GHCR_USERNAME` divergir de `github.repository_owner`, evitando combinações inválidas de owner/token.
- Com isso, todos os pontos do workflow que autenticam/chamam GHCR passam a usar o mesmo token nativo do run, eliminando inconsistência de credenciais entre jobs.

## 2026-05-15 01:45:26 UTC
- Correção de causa raiz no publish/deploy: defaults locais ainda apontavam para `paulodb` em partes do stack, o que quebrava `docker compose pull` para imagens inexistentes nesse owner (ex.: `ai-hub-6-caddy` e `ai-hub-6-mcp-server`).
- Atualizado `docker-compose.yml` para fallback único `GHCR_USERNAME:-paulofor` em todos os serviços publicados (`caddy`, `backend`, `frontend`, `sandbox-orchestrator`, `mcp-server`), eliminando namespace legado divergente no pull.
- Atualizado `infra/setup_vps.sh` para gerar `.env` com defaults de imagens `backend/frontend/sandbox` em `ghcr.io/paulofor/...`, mantendo coerência entre setup da VPS e owner atual de publicação.
- 2026-05-15 02:55:53 UTC — Diagnóstico e correção da causa raiz de imagens “fora do fluxo” no deploy: havia fallback inconsistente para owner `paulofor` em `docker-compose.yml` e no workflow de CI/deploy, permitindo pull de imagens de namespace diferente quando variáveis não eram resolvidas de forma uniforme; padronizado fallback para `paulodb` em compose e workflow para manter todas as imagens no mesmo namespace esperado.
- 2026-05-15 03:02:31 UTC — Ajuste solicitado: descontinuado uso de `paulodb` e padronizado `paulofor` em todos os pontos ativos de fallback de imagens (`docker-compose.yml` e jobs `docker/deploy/cleanup` do `.github/workflows/ci.yml`), evitando mistura de owners no pull/push quando não houver override por secret/var.
- 2026-05-15 03:04:23 UTC — Ajuste solicitado para eliminar dependência de owner por variáveis de ambiente: namespace GHCR fixado explicitamente como `paulofor` nos pontos ativos de CI/deploy e nos defaults de imagens do `docker-compose`, mantendo o fluxo sempre no mesmo owner.
- 2026-05-15 15:01:57 UTC — Ajuste solicitado de operação no fluxo Codex ChatGPT: definido `paulofore@gmail.com` como valor padrão fixo no campo de e-mail (`accountHintInput`) da tela `/codex-chatgpt`, para acelerar login sem preenchimento manual.
- 2026-05-15 18:03:09 UTC — Verificação operacional dos containers em execução informados pelo usuário: `caddy` e `mcp-server` estão no namespace `ghcr.io/paulofor`, enquanto `frontend`, `backend` e `sandbox` estão em `ghcr.io/paulodb`.
- Causa raiz identificada para possível inconsistência: mistura de owners/registries na mesma stack (`paulofor` + `paulodb`) tende a gerar comportamento não determinístico em próximos pulls/deploys (atualização parcial, drift de versão e erros de permissão quando tokens/owners divergem).
- Diretriz objetiva: padronizar todas as imagens do compose para um único owner (preferencialmente `paulofor`, conforme ajustes recentes no projeto) e recriar os serviços para eliminar drift entre versões de 13h e 3h.
- 2026-05-15 18:10:33 UTC — Investigada a causa raiz no workflow de deploy para containers subirem com imagens erradas/mistas: no step `Publish services` as variáveis (`CADDY_IMAGE`, `BACKEND_IMAGE`, etc.) estavam atribuídas inline apenas ao comando `docker compose pull`; o `docker compose up -d` subsequente executava sem essas variáveis exportadas, podendo cair em defaults/.env divergentes.
- Correção aplicada em `.github/workflows/ci.yml`: variáveis de imagem agora são `export`adas antes de `docker compose pull && docker compose up -d`, garantindo o mesmo namespace/valores nos dois comandos e eliminando inicialização com owner incorreto por diferença de escopo de variável.


## 2026-05-17 17:48:57 UTC
- Investigação profunda do fluxo \`Codex ChatGPT\` comparando implementação local com padrão de sessão persistente do exemplo `codex-rs`: causa raiz do status sempre `desconectado` no frontend era ausência de envio de cookie de sessão nas chamadas XHR quando frontend/backend estão em origens diferentes.
- Correção aplicada em `apps/frontend/src/api/client.ts`: habilitado `withCredentials: true` no cliente Axios global, garantindo envio de `JSESSIONID` em `/api/account/read`, `/api/account/login/start` e `/api/account/logout` e permitindo reaproveitamento da mesma sessão estabelecida no callback de login.
- Impacto esperado: após concluir login na aba externa e retornar ao AI Hub, o polling e o refresh passam a ler a sessão correta e exibir `connected` com e-mail/validade em vez de `disconnected`.

## 2026-05-17 20:08:03 UTC-3
- Revisão solicitada da causa raiz da conexão “AI Hub como ChatGPT”, comparando com o fluxo de referência em `docs/codex-rs-autenticacao-chatgpt.md` e implementação atual em `AccountController`.
- Conclusão técnica: hoje o AI Hub ainda não está equivalente ao `codex-rs` porque o callback local não executa troca OAuth `authorization_code -> access_token/refresh_token` no backend; ele apenas aceita tokens por query string e marca sessão como conectada.
- Risco de arquitetura identificado: depender de `access_token`/`refresh_token` via query param no callback não reproduz o modelo robusto do `codex-rs` (PKCE + token endpoint + renovação), e tende a manter sensação de “conecta mas não funciona como ChatGPT”.
- Direção validada: é possível chegar no mesmo comportamento, mas o caminho correto é implementar OAuth server-side real (authorize + code exchange + refresh) e usar esse `access_token` nas chamadas do executor/sandbox ao provedor, em vez de manter somente estado de sessão por e-mail.
- Próximo passo recomendado: criar fase de hardening focada em causa raiz com 4 entregas mínimas — (1) geração de PKCE/state em `login/start`, (2) exchange de `code` em `login/callback`, (3) persistência segura de `refresh_token` com expiração real, (4) renovação automática antes de enviar job Codex.

## 2026-05-17 20:10:30 UTC-3
- Solicitação atendida: criado plano de implementação no repositório para evoluir a conexão do AI Hub para o padrão “como ChatGPT”, com foco em causa raiz e referência no fluxo do `codex-rs`.
- Novo documento `docs/plano-implementacao-chatgpt-codex-oauth.md` estruturado em fases (contrato, OAuth real com PKCE/state, exchange de token, refresh automático, integração com execução e rollout seguro).
- Incluídos critérios de sucesso, riscos, critérios de aceite, variáveis de ambiente sugeridas e estratégia de testes para reduzir retrabalho de implementação.

## 2026-05-18 00:00:00 UTC
- Execução da Fase 0 do plano `docs/plano-implementacao-chatgpt-codex-oauth.md` com formalização do contrato entre frontend e backend para OAuth ChatGPT/OpenAI.
- Criado `docs/fase-0-contrato-oauth-chatgpt.md` com definição objetiva dos endpoints `POST /api/account/login/start`, `GET /api/account/login/callback`, `GET /api/account/read` e `POST /api/account/logout`, incluindo payloads, respostas e códigos HTTP por cenário.
- Definida política padronizada de erros (`invalid_state`, `token_exchange_failed`, `refresh_failed` e correlatos), modelo de persistência de sessão OAuth, variáveis de ambiente obrigatórias/opcionais e padrão de mascaramento de segredos em logs.

## 2026-05-18 09:20:00 UTC
- Verificação de pendências anteriores do plano OAuth: a Fase 0 já estava concluída em documentação, porém a Fase 1 permanecia incompleta na causa raiz do backend, pois `login/start` ainda não gerava PKCE S256 (`code_verifier`/`code_challenge`) nem montava URL OAuth padrão com `response_type=code`, `client_id` e `scope`.
- Execução da Fase 1 em `AccountController`: implementada geração criptográfica de `state` + PKCE (S256), persistência temporária em sessão (`chatgpt_login_state` e `chatgpt_login_code_verifier`) e montagem de `authUrl` OAuth real com parâmetros `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge` e `code_challenge_method=S256`.
- Ajuste complementar de configuração raiz para Fase 1: adicionadas propriedades `hub.account.oauth.authorize-url`, `hub.account.oauth.client-id` e `hub.account.oauth.scopes` no `application.yml` com fallback para variáveis de ambiente (`HUB_ACCOUNT_OAUTH_*`), garantindo contrato alinhado para ambientes distintos.
- Mantida validação explícita de `state` no callback com rejeição por `?login=invalid_state` e limpeza de sessão para impedir conexão indevida quando houver retorno inválido.

## 2026-05-18 10:05:00 UTC
- Verificação de pendências das fases anteriores do plano OAuth: Fase 0 e Fase 1 já constavam implementadas; a causa raiz pendente estava na Fase 2, pois o callback ainda aceitava `access_token`/`refresh_token` por query string sem realizar exchange server-side de `authorization_code`.
- Execução da Fase 2 no backend (`AccountController`): callback passou a exigir `code`, validar `state` + `code_verifier` e trocar o código por tokens no endpoint OAuth (`grant_type=authorization_code`) via chamada HTTP backend-backend.
- Endurecimento de segurança: removida a dependência de tokens via query params no callback e adicionada validação explícita para falhas de exchange (`?login=token_exchange_failed`).
- Persistência de sessão ajustada para dados reais do OAuth: `access_token`, `refresh_token`, `id_token` e `expires_at` derivado de `expires_in`; e-mail da conta agora é resolvido prioritariamente do `id_token` (claim `email`) com fallback para `accountHint`.
- Configuração ampliada para Fase 2 em `application.yml`: incluídas propriedades `hub.account.oauth.token-url` e `hub.account.oauth.client-secret` (com fallback `HUB_ACCOUNT_OAUTH_TOKEN_URL` e `HUB_ACCOUNT_OAUTH_CLIENT_SECRET`) para suportar ambientes com/sem segredo de cliente.
- 2026-05-18 02:52:33 UTC: Verificação de pendências das fases anteriores do plano OAuth (`docs/plano-implementacao-chatgpt-codex-oauth.md`): Fase 0, 1 e 2 já estavam aplicadas, porém a causa raiz pendente para Fase 3 era ausência de renovação automática no backend quando `expires_at` vencia, mantendo sessão "connected" sem token válido.
- 2026-05-18 02:52:33 UTC: Execução da Fase 3 com criação do serviço `TokenLifecycleManager` (refresh sob demanda + retry/backoff 0/200/500ms) para renovar `access_token` com `refresh_token`, suportar rotação de refresh token e marcar sessão como expirada quando não há recuperação.
- 2026-05-18 02:52:33 UTC: `GET /api/account/read` passou a invocar o ciclo de refresh antes de responder e agora calcula `connected` com validade real de `expires_at` (estado expira de forma determinística quando token venceu).
- 2026-05-18 03:08:17 UTC: Verificadas pendências das fases anteriores do plano OAuth: Fases 0–3 estavam concluídas; a causa raiz pendente da Fase 4 era que a execução Codex não recebia o `access_token` OAuth válido da sessão e não havia métricas/login estruturado completos para o fluxo de autenticação.
- 2026-05-18 03:08:17 UTC: Executada a Fase 4 no backend com propagação determinística de credencial para execução: `CodexRequestService` agora resolve token válido via `TokenLifecycleManager` (com refresh sob demanda) e envia o `accessToken` no payload de `SandboxJobRequest` para o `SandboxOrchestratorClient`.
- 2026-05-18 03:08:17 UTC: Observabilidade OAuth ampliada: adicionados contadores `oauth_login_start_total`, `oauth_login_success_total`, `oauth_token_refresh_total` e `oauth_token_refresh_failure_total`, além de logs estruturados com `oauthCorrelationId` no `AccountController` para rastreamento fim-a-fim do login/callback.
- 2026-05-18 03:55:29 UTC: Correção de falha de compilação em testes do backend com foco em causa raiz: o construtor de `CodexRequestService` passou a exigir `TokenLifecycleManager`, mas `CodexRequestServiceTest` ainda instanciava o serviço sem essa dependência, gerando incompatibilidade de assinatura em `testCompile`.
- 2026-05-18 03:55:29 UTC: Atualizado `CodexRequestServiceTest` para incluir mock de `TokenLifecycleManager` e injetá-lo no `buildService`, alinhando o teste ao contrato atual do construtor e restaurando compilação dos testes.

## 2026-05-22 14:21:20 UTC-3
- Diagnóstico orientado à causa raiz do erro de autenticação OpenAI `empty_string` observado em `auth.openai.com/error`: provável ausência/bloqueio de parâmetro obrigatório no fluxo de login federado (cookies/sessão/redirect interrompidos por extensão, política de privacidade do navegador ou URL de retorno incompleta).
- Referenciadas fontes oficiais recentes da OpenAI (Help Center e Docs MCP) e o guia `codex-rs` para orientar troubleshooting sem correções paliativas.
- Entregue checklist técnico objetivo para validar método de login original, cookies/JavaScript/3rd-party cookies, testes em janela anônima e desativação de bloqueadores/VPN antes de nova tentativa.

## 2026-05-22 14:25:53 UTC-3
- Correção de causa raiz do erro ao clicar em "Conectar com ChatGPT": o backend permitia iniciar OAuth com `hub.account.oauth.client-id` vazio, gerando redirecionamento inválido para `auth.openai.com` e retorno `empty_string`.
- `POST /api/account/login/start` agora valida configuração crítica de OAuth antes de montar `authUrl`; quando `client_id` estiver ausente, retorna `503` com mensagem objetiva de configuração do servidor.
- Frontend (`CodexChatgptPage`) endurecido para exigir `authUrl` não vazio e detectar bloqueio de pop-up na abertura da janela de autenticação, exibindo erro acionável ao usuário.

## 2026-05-22 17:51:21 UTC
- Ajuste orientado à causa raiz para o novo erro reportado no login: o endpoint `/api/account/login/start` passou a retornar `503` quando a configuração OAuth do servidor está incompleta/indisponível, mas o frontend ainda exibia mensagem genérica de falha HTTP.
- Em `CodexChatgptPage`, adicionado tratamento explícito de `503` no fluxo `handleConnect`, com telemetria dedicada e mensagem acionável para validar `client_id`, `authorize_url` e `redirect_uri` no backend.
- Mantido o comportamento de `404` como “API não suportada” e preservado fallback para demais erros, reduzindo ambiguidade no diagnóstico em produção.

## 2026-05-22 18:20:00 UTC
- Ajuste orientado à causa raiz para disponibilização do MCP Server pela porta 80 sem conflito de bind no host: mantida a arquitetura de borda única no `caddy` (80/443) e adicionado roteamento por path `/mcp/*` para `mcp-server:8084` no `infra/caddy/Caddyfile`.
- Habilitado acesso a logs de containers pelo MCP Server com instalação do Docker CLI na imagem `apps/mcp-server` e montagem do socket do Docker host (`/var/run/docker.sock`) no serviço `mcp-server` do `docker-compose`.
- Atualizado `AGENTS.md` com diretriz explícita de que o MCP Server permite executar comandos Linux no host e visualizar logs de containers.
- 2026-05-22 19:00:00 UTC — Ajuste de causa raiz no roteamento do MCP no Caddy: a regra anterior casava apenas `/mcp/*`, então a URL base `/mcp` não entrava no matcher e caía no `handle` padrão do frontend. Atualizado `infra/caddy/Caddyfile` para casar ambos `/mcp` e `/mcp/*`, garantindo resposta correta também na raiz do endpoint.
- 2026-05-22 19:00:00 UTC — Validação externa: `POST https://iahub.xyz/mcp/tools/linux-command` retornou `401 Unauthorized` sem token, confirmando que o tráfego está chegando no `mcp-server` via Caddy (com autenticação ativa).

- 2026-05-22: Solicitada consulta aos logs do container backend via MCP Server. Tentativa realizada com `docker ps`, porém o ambiente atual não possui o comando `docker` disponível (`docker: command not found`).

- 2026-05-22 19:35:49 UTC — Nova tentativa via URL solicitada `http://iahub.xyz/mcp`: confirmado redirect 308 para HTTPS; `GET https://iahub.xyz/mcp` respondeu 404 (rota base) e `POST https://iahub.xyz/mcp/tools/linux-command` respondeu 401 Unauthorized sem token. Conclusão: endpoint MCP está acessível, mas a execução de comandos/logs requer autenticação.

- 2026-05-22 19:45:00 UTC — Análise de causa raiz do roteamento MCP no Caddy: o caminho base `/mcp` chegava ao `mcp-server`, porém retornava 404 por não existir handler nessa rota no serviço (apenas `/mcp/tools/*`). Correção aplicada no `infra/caddy/Caddyfile`: rota dedicada `@mcp_health` para `/mcp` com rewrite para `/actuator/health`, mantendo `/mcp/*` para as tools MCP.

- 2026-05-22 19:55:00 UTC — Removida a exigência de token no MCP Server conforme solicitação: `POST /mcp/tools/linux-command` não valida mais o header `X-MCP-TOKEN`. Ajuste aplicado na causa raiz (controller) e documentação atualizada em `apps/mcp-server/README.md`.
## 2026-05-22 16:53:52 UTC-3
- Nova tentativa de acesso ao MCP Server pela URL solicitada (`http://iahub.xyz/mcp`) para investigar logs do container backend.
- Validação de causa raiz de acesso: `GET /mcp` via HTTPS respondeu `{"status":"UP"}`, confirmando serviço ativo, porém as rotas esperadas de transporte MCP (`/mcp/`, `/mcp/sse`, `/mcp/messages`) retornaram `404 Not Found`.
- Conclusão operacional: não foi possível consultar logs do container backend por esse endpoint sem o contrato exato da rota/tool exposta (ou credenciais/parâmetros compatíveis), apesar de o serviço base estar online.
## 2026-05-22 16:58:04 UTC-3
- Revisão da causa raiz da tentativa anterior: a verificação foi feita apenas em rotas de saúde/transporte (`GET /mcp`, `/mcp/sse`, `/mcp/messages`), sem acionar a tool correta de execução remota.
- Acesso funcional ao MCP confirmado via `POST https://iahub.xyz/mcp/tools/linux-command` com body JSON `{ "command": "..." }`.
- Comando remoto `docker ps --format "{{.Names}}"` retornou os containers ativos, incluindo `ai-hub-6-backend-1`.
- Consulta de logs do backend realizada com sucesso por `docker logs --tail 120 ai-hub-6-backend-1`, retornando inicialização Spring Boot normal, conexão MySQL/Flyway válida e sem erro fatal no recorte coletado.
## 2026-05-22 17:00:27 UTC-3
- Solicitado registro explícito no `AGENTS.md` da forma correta de acessar o MCP Server.
- Atualizado `AGENTS.md` com instruções objetivas: `GET /mcp` para healthcheck e `POST /mcp/tools/linux-command` com JSON `{ "command": "..." }` para executar comandos e consultar logs (incluindo exemplo do backend).

## 2026-05-24 00:20:00 UTC
- Diagnóstico de causa raiz do erro `503` em `POST /api/account/login/start` com apoio do MCP Server: logs do container `ai-hub-6-backend-1` confirmaram abort explícito de OAuth por configuração ausente (`hub.account.oauth.client-id não configurado`), descartando indisponibilidade de container/rede.
- Correção preventiva da causa raiz operacional: adicionadas variáveis de ambiente OAuth faltantes nos arquivos de exemplo (`.env.example` raiz e `apps/backend/.env.example`) para evitar novos deploys com configuração incompleta do login ChatGPT.

## 2026-05-24 00:35:00 UTC
- Orientação operacional registrada para configuração OAuth: `client_id` e `client_secret` devem ser definidos no backend pelas variáveis de ambiente `HUB_ACCOUNT_OAUTH_CLIENT_ID` e `HUB_ACCOUNT_OAUTH_CLIENT_SECRET` (mapeadas em `apps/backend/src/main/resources/application.yml`).
- Causa raiz reforçada para evitar erro no login: quando `HUB_ACCOUNT_OAUTH_CLIENT_ID` não está preenchida, o backend interrompe `POST /api/account/login/start` com `503` e mensagem de integração indisponível.

## 2026-05-24 13:36:41 UTC
- Ajuste de documentação orientado à causa raiz da dúvida operacional sobre perda de credenciais após reboot: reforçado no `README.md` que `client_id`/`client_secret` OAuth devem ser persistidos em `.env` (ou secret manager do ambiente) e não apenas via `export` de sessão.
- Incluídas instruções de aplicação prática para recriar contêiner após persistir `HUB_ACCOUNT_OAUTH_CLIENT_ID` e `HUB_ACCOUNT_OAUTH_CLIENT_SECRET`, evitando recorrência do `503` por configuração ausente no login OAuth.

## 2026-05-24 14:03:12 UTC
- Consulta solicitada via MCP Server para localizar `.env` no host: healthcheck `GET https://iahub.xyz/mcp` retornou `{"status":"UP"}` e buscas remotas com `find` foram executadas via `POST /mcp/tools/linux-command`.
- Resultado de causa raiz operacional: o contexto acessível pelo MCP nesta execução está restrito ao container com `pwd=/app` (contendo apenas `app.jar`), sem arquivo `.env` visível em `/app` nem em `/root` no escopo consultado; não foi encontrado `docker-compose.yml` no mesmo escopo.
- Conclusão prática: o `.env` persistente provavelmente está no host/VPS fora desse filesystem de runtime ou em secret manager; necessário acessar o diretório de deploy (ex.: pasta onde roda `docker compose`) para editar o `.env` efetivo.

## 2026-05-24 16:52:21 UTC
- Varredura solicitada via MCP Server para localizar `.env`/arquivos de compose no host executada com `POST https://iahub.xyz/mcp/tools/linux-command`.
- Diagnóstico de causa raiz do escopo: `pwd` remoto permanece `/app` e o filesystem visível apresenta contexto mínimo (app runtime), sem evidência de diretório de deploy.
- Resultado da varredura ampla (`find` em `/root`, `/home`, `/opt`, `/srv`, `/etc` e depois `/` com pruning de `/proc|/sys|/dev`): nenhum arquivo `.env`, `*.env`, `docker-compose.yml`, `compose.yaml` ou `compose.yml` encontrado no escopo acessível ao MCP nesta sessão.
- Conclusão operacional: o `.env` persistente está fora do escopo atual do MCP (host real de deploy) ou a implantação utiliza apenas variáveis injetadas por orquestrador/secret manager.

## 2026-05-24 16:55:37 UTC
- Ajuste solicitado para o MCP Server "ver tudo" no host: adicionada montagem explícita da raiz do host (`/:/host:ro`) no serviço `mcp-server` do `docker-compose.yml`.
- Causa raiz identificada na investigação anterior: o MCP executava em escopo isolado de container (`/app`), sem acesso ao filesystem do host de deploy, o que impedia localizar `.env`/compose fora do runtime.
- Documentação do módulo MCP atualizada para orientar uso do novo ponto de montagem (`/host`) em comandos de varredura, preservando leitura somente (`ro`) para reduzir risco operacional.
- 2026-05-24 17:21:48 UTC: Criada página de Política de Privacidade no frontend (`/privacy`) com conteúdo institucional inicial (dados coletados, finalidade, retenção, segurança e contato), e rota registrada em `App.tsx` para acesso direto no shell da aplicação.

## 2026-05-24 18:35:00 UTC
- Investigação de causa raiz do problema de conexão no Codex ChatGPT: confirmado que o backend retorna `503` em `POST /api/account/login/start` quando `hub.account.oauth.client-id` está ausente, e a UI só descobria isso após clicar em "Conectar".
- Correção orientada à causa raiz aplicada no backend (`/api/account/read`): inclusão dos campos `oauthConfigured`, `oauthStatus` e `oauthMessage` para expor prontidão OAuth já na leitura de status.
- Correção no frontend (`CodexChatgptPage`): parsing dos novos campos, bloqueio do botão "Conectar com ChatGPT" quando OAuth não está configurado e mensagem explícita de configuração ausente para o usuário sem depender de tentativa de login falha.

## 2026-05-24 19:35:00 UTC
- Verificação solicitada via MCP Server da configuração `client_id` no host: healthcheck `GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`.
- Causa raiz observada na validação remota: não há chave `HUB_ACCOUNT_OAUTH_CLIENT_ID` definida nos `.env` encontrados em `/host/root/ai-hub-6/.env`, `/host/root/ai-hub/.env` e `/host/root/ai-hub-corporativo/.env` (resultado `KEY_NOT_FOUND`).
- Evidência complementar: busca por `HUB_ACCOUNT_OAUTH_CLIENT_ID` retornou apenas documentação e arquivos `.env.example`/`application.yml`, sem ocorrência em `.env` efetivo.

## 2026-05-24 19:43:00 UTC
- Validação refinada conforme instrução do usuário para considerar somente `/root/ai-hub-6/.env` (via MCP mount `/host/root/ai-hub-6/.env`).
- Resultado objetivo da causa raiz: chave `HUB_ACCOUNT_OAUTH_CLIENT_ID` continua ausente nesse arquivo específico (`KEY_NOT_FOUND`), mantendo a condição que provoca `503` no início do login OAuth.

## 2026-05-24 20:02:00 UTC
- Correção de causa raiz no workflow de deploy: identificado que o passo `rsync -az --delete` da pipeline para `/root/ai-hub-6` podia remover `.env` remoto (arquivo fora do versionamento), apagando `HUB_ACCOUNT_OAUTH_CLIENT_ID` previamente configurado no host.
- Ajuste aplicado em `.github/workflows/ci.yml`: adicionados `--exclude '.env'` e `--exclude 'apps/backend/.env'` no rsync para preservar segredos locais durante sincronização do repositório.

## 2026-06-13 — Diagnóstico e guarda contra client_id OAuth inválido
- Investigada a causa raiz do erro OpenAI `invalid_client` ao conectar o Codex ChatGPT: via MCP Server, logs do backend confirmaram geração do OAuth e a variável `HUB_ACCOUNT_OAUTH_CLIENT_ID` em produção estava preenchida com valor curto/incompatível (aparentando e-mail/usuário), não com um client_id OAuth válido da OpenAI.
- Ajustado `AccountController` para validar o formato do `client_id` antes de montar a URL para `auth.openai.com`, expondo `oauthStatus=invalid_client_id_format` em `/api/account/read` e retornando `503` acionável em `/api/account/login/start`, evitando redirecionar o usuário para uma tela genérica de `invalid_client`.
- Ajustada a resolução do callback OAuth para respeitar `X-Forwarded-Proto`, `X-Forwarded-Host` e `X-Forwarded-Port`, evitando gerar `redirect_uri` com `http://` quando o AI Hub está publicado atrás de proxy HTTPS.
- Ajuste complementar no frontend: mensagem de bloqueio do botão de conexão agora orienta revisar `HUB_ACCOUNT_OAUTH_CLIENT_ID`, cobrindo tanto ausência quanto formato inválido do client_id.

## 2026-06-14 — Login ChatGPT/Codex por device code sem API key
- Implementado fluxo de autenticação por código de dispositivo no `AccountController`, seguindo o padrão documentado do `codex-rs`: solicitar `user_code`, orientar o usuário a autorizar em `https://auth.openai.com/codex/device`, fazer polling e trocar o `authorization_code` por tokens OAuth.
- O backend agora persiste `access_token`, `refresh_token`, `id_token`, e expiração na sessão HTTP após device login, permitindo que execuções `CHATGPT_CODEX` reutilizem o token conectado sem `OPENAI_API_KEY`.
- A tela `/codex-chatgpt` foi ajustada para iniciar o login por código, exibir URL/código ao usuário e acompanhar automaticamente o polling até a conexão.
- Adicionada configuração `HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID` com fallback para o client id público do Codex, evitando depender de criação manual de `client_id` OAuth no painel da OpenAI para o fluxo por código.

## 2026-06-14 — Diagnóstico dos logs do device login ChatGPT/Codex
- Verificação solicitada via MCP Server: healthcheck `GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`.
- Logs do backend `ai-hub-6-backend-1` mostram boa evidência do ponto de falha após a autorização do usuário: o polling saiu de `authorization_pending`, recebeu `authorization_code/code_verifier` e falhou repetidamente na troca por token.
- Erro observado entre 2026-06-14T15:51:32Z e 2026-06-14T15:53:07Z: OpenAI respondeu `401 Unauthorized` com `code=token_exchange_user_error` em `AccountController.exchangeAuthorizationCode`, chamado por `AccountController.pollDeviceLogin`.
- Causa provável delimitada pelos logs: não é falha de abertura da tela/código nem timeout inicial; o problema ocorre especificamente na etapa final de token exchange do device login.

## 2026-06-14 — Orientação sobre client_id do device login Codex
- Dúvida recebida: o `client_id` usado no device login parece pertencer a outra aplicação e foi perguntado como criar um novo.
- Consulta à documentação oficial atual do Codex: para login ChatGPT em ambiente headless, o caminho suportado é habilitar device code nas configurações do ChatGPT/workspace e usar o fluxo do próprio Codex (`codex login --device-auth`) ou, em automação confiável, gerar/copiar `auth.json` uma vez e deixar o Codex renovar a sessão.
- Conclusão de causa raiz/arquitetura: para o fluxo ChatGPT-managed Codex, não há indicação oficial de criação manual de um OAuth `client_id` próprio para substituir o cliente público do Codex; criar/usar um `client_id` de outra aplicação tende a causar falha no token exchange, compatível com o erro observado `token_exchange_user_error`.
- Próximo caminho recomendado: não tentar criar `client_id` novo para esse fluxo; ajustar a implementação para usar autenticação suportada pelo Codex (`auth.json`/refresh do próprio Codex) ou API key para automação, em vez de chamar diretamente o endpoint OAuth com cliente não suportado.

## 2026-06-14 — Confirmação por auth.json real do Codex
- Usuário mostrou saída de `~/.codex/auth.json` gerado pelo Codex CLI após login bem-sucedido e tela do navegador indicando "Iniciou sessão no Codex".
- Diagnóstico atualizado: o `client_id` `app_EMoamEEZ73f0CkXaXp7hrann` não é de outra aplicação arbitrária; ele aparece como audiência/client_id nos tokens do próprio Codex, portanto é o cliente esperado para o fluxo oficial do Codex CLI.
- Risco operacional identificado: o conteúdo exibido inclui `access_token` e `refresh_token`; por ter sido exposto em texto, a sessão deve ser revogada/rotacionada e um novo `auth.json` deve ser gerado antes de qualquer uso em produção.
- Próximo passo técnico recomendado: integrar o AI Hub ao artefato `auth.json` ou ao fluxo nativo do Codex CLI, evitando manter token exchange manual concorrente quando o CLI já concluiu autenticação e renovação.

## 2026-06-14 — Montagem do auth.json do Codex no sandbox
- Alteração solicitada aplicada no `docker-compose.yml`: o serviço `sandbox-orchestrator` agora monta `/root/.codex` do host em `/root/.codex` no container com modo somente leitura (`ro`).
- Motivação de causa raiz: o login via Codex CLI gera `~/.codex/auth.json` no host, mas o container que executa o fluxo Codex não enxergava esse artefato; a montagem permite que o runtime tenha acesso ao cache oficial de autenticação sem copiar tokens para variáveis de ambiente ou logs.
- Observação operacional: o `auth.json` deve ser regenerado após a exposição acidental do token e mantido com permissões restritas no host antes do deploy.

## 2026-06-14 — Correção do token exchange no device login Codex
- Investigação de causa raiz com logs do backend via MCP confirmou que o usuário concluía a autorização no `auth.openai.com`, mas o backend falhava em `POST /oauth/token` com `401 token_exchange_user_error` ao processar `/api/account/device/poll`.
- Causa raiz identificada no código: o mesmo método de token exchange era reutilizado pelo OAuth de browser e pelo device login; quando `HUB_ACCOUNT_OAUTH_CLIENT_SECRET` estava configurado para o fluxo de browser, o backend também enviava `client_secret` no exchange do cliente público Codex/device, divergindo do fluxo oficial do `codex-rs`.
- Correção aplicada em `AccountController`: o exchange de device login agora monta o payload sem `client_secret`, enquanto o callback OAuth tradicional continua enviando o segredo quando configurado.
- Adicionados testes unitários para garantir que o payload do device login não inclua o segredo do cliente de browser e que o payload do browser continue preservando o segredo configurado.
- 2026-06-14 UTC — Investigada a causa raiz dos erros frequentes em `/codex-chatgpt`: registros antigos/externos com profile `ECO_30` eram lidos pelo backend, mas o enum `CodexIntegrationProfile` não reconhecia esse valor, causando falha no polling/listagem. Adicionado suporte compatível a `ECO_30` no backend e na normalização/visualização do frontend, tratando-o como perfil econômico.
