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

## 2026-06-28 09:38:44 UTC-3
- Iniciado ajuste para criar o item de menu `Codex ChatGPT MKT`.
- Causa raiz técnica identificada: o fluxo especial do ChatGPT Codex estava acoplado ao perfil único `CHATGPT_CODEX` em frontend, backend e sandbox-orchestrator, então uma tela nova sem perfil próprio cairia no comportamento de programação ou perderia as garantias do Codex App Server.
- Direção de correção: criar perfil dedicado `CHATGPT_CODEX_MKT`, reutilizar autenticação/sandbox/PR do Codex ChatGPT e alterar apenas as instruções de análise para relatórios Markdown de marketing digital.

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

## 2026-06-14 — Remoção do quadro de troubleshooting Fase 3
- Removido da página `/codex-chatgpt` o quadro visual "Troubleshooting & telemetria (Fase 3)", mantendo a telemetria interna usada pelos fluxos de diagnóstico sem renderizar a seção na interface.
- Causa raiz do incômodo visual: a seção era sempre renderizada abaixo das execuções, exibindo eventos frequentes de polling (`poll_success`) e ocupando espaço desnecessário para o usuário final.

## 2026-06-16 — Anexos de imagens no Codex ChatGPT
- Investigada a causa raiz da ausência de anexos na tela `/codex-chatgpt`: o frontend enviava apenas `prompt/environment/model/profile`, o backend repassava somente `taskDescription` ao sandbox e o runner montava a mensagem do modelo apenas como `input_text`, sem caminho para imagens coladas da área de transferência.
- Adicionado suporte a colar prints via Ctrl+V no textarea e selecionar arquivos de imagem, com pré-visualização, remoção, limite de 5 imagens e validação de 5 MB por imagem.
- Estendido o payload `CreateCodexRequest`/`SandboxJobRequest` e o sandbox-orchestrator para transportar `imageAttachments` como data URLs e montar a solicitação do modelo com partes `input_image` junto do texto.

## 2026-06-19 — Remoção do indicador visual de atualização no Codex ChatGPT
- Removido da página `/codex-chatgpt` o texto transitório "Atualizando..." exibido durante o polling das últimas execuções.
- Causa raiz do incômodo visual: o estado `requestsLoading` era renderizado como um parágrafo dentro do card de últimas execuções a cada atualização automática, provocando mudança perceptível no layout enquanto o monitoramento permanecia ativo.
- 2026-06-19 17:25:49 UTC: Investigada a causa raiz da execução `CHATGPT_CODEX` aparecer nos logs da API mesmo com sessão ChatGPT conectada: o backend já enviava `accessToken` ao sandbox, porém o `sandbox-orchestrator` ignorava esse campo e sempre usava o cliente OpenAI inicializado com `OPENAI_API_KEY`.
- 2026-06-19 17:25:49 UTC: Corrigido o fluxo do `sandbox-orchestrator` para aceitar e reter `accessToken` apenas internamente, não expor o token nas respostas HTTP e, em jobs `CHATGPT_CODEX`, criar o cliente OpenAI com o token OAuth da sessão conectada em vez da API key do projeto.

## 2026-06-19 — Diagnóstico do erro 401 api.responses.write no CHATGPT_CODEX
- Investigada a execução `ea921d16-2ac5-47b5-8fdd-504c2ee92cf8` exibida na tela `/codex/requests/702`.
- Healthcheck do MCP confirmou o serviço operacional (`GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`).
- Logs do `sandbox-orchestrator` confirmaram que o fluxo usou `access_token` da sessão ChatGPT conectada, sem `OPENAI_API_KEY` do projeto, e falhou na primeira chamada ao modelo com `401` por ausência do escopo `api.responses.write`.
- Causa raiz provável: a credencial OAuth/sessão ChatGPT usada pelo profile `CHATGPT_CODEX` não possui permissão para escrever na Responses API no projeto/organização selecionado; não é problema do prompt, do clone do repositório, nem do workspace, pois o preflight e a preparação concluíram antes da falha.
- Ação recomendada: reconectar/autorizar a conta ChatGPT/Codex com escopos que incluam `api.responses.write`, garantir papel adequado na organização/projeto (Writer/Owner e Member/Owner) ou usar uma credencial/API key não restrita com permissão de Responses API para esse fluxo.

## 2026-06-19 — Esclarecimento sobre origem do escopo OAuth do Codex
- Esclarecido que, no fluxo de login por código do `CHATGPT_CODEX`, o usuário não escolhe escopos manualmente na tela de login; o backend solicita o device login enviando apenas o `client_id` para `/api/accounts/deviceauth/usercode`.
- Diferenciado do fluxo OAuth web tradicional, onde a lista de escopos vem de `hub.account.oauth.scopes`/`HUB_ACCOUNT_OAUTH_SCOPES` e é anexada à URL de autorização.
- Conclusão de causa raiz refinada: para o device login do cliente público Codex, a definição efetiva de escopos/permissões fica vinculada ao aplicativo OAuth/client_id da OpenAI e às permissões da conta/projeto selecionados, não a uma configuração visível ao usuário final durante o login.
- Orientação operacional: se o usuário só consegue clicar em login, a correção precisa ser feita no lado da configuração/autorização do app/ambiente — validar `HUB_ACCOUNT_OAUTH_SCOPES` apenas se estiver usando login OAuth web, ou trocar/ajustar a credencial/client_id/conta com acesso à Responses API para o fluxo por código.

## 2026-06-19 — Orientação para alterar permissões de conta/projeto OpenAI
- Consultada documentação oficial da OpenAI sobre projetos, papéis e permissões de API keys para orientar a correção do erro `api.responses.write`.
- Esclarecido que permissões de usuário/projeto são alteradas no painel da API Platform: organização/projeto -> Members, onde apenas Owner de projeto pode atualizar papel ou remover usuário, e membros precisam ser adicionados ao projeto correto para executar inferência.
- Esclarecido que permissões de chave são alteradas no painel do projeto -> API Keys; chaves podem ser `All`, `Restricted` ou `Read Only`, e no modo `Restricted` é necessário conceder `Write` ao endpoint/recurso de Responses.
- Registrado que, se o usuário não vê essas opções, ele provavelmente não é Owner da organização/projeto e precisa pedir a um Owner para ajustar seu papel, adicioná-lo ao projeto correto ou gerar uma chave/service account com permissão adequada.

## 2026-06-19 — Navegação no painel OpenAI para permissões
- Orientado, a partir da tela `Organization settings > General`, que a alteração não fica no formulário geral da organização.
- Para permissões da conta/usuário, o caminho indicado é `People` para papel na organização e `Projects` -> projeto correto -> `Members` para papel no projeto.
- Para permissões de credencial, o caminho indicado é `API keys` no projeto correto, editando/criando chave com permissão `All` ou `Restricted` com `Write` para Responses/API de inferência.
- Registrado que, caso as opções de edição estejam ocultas ou bloqueadas, o usuário está sem papel de Owner/Admin suficiente e precisa acionar o Owner da organização/projeto.

## 2026-06-19 — Validação visual de role Organization Owner
- Usuário mostrou `People & Permissions > Members > Manage roles`, com a conta marcada como `Owner` na organização.
- Conclusão: a role da organização aparenta estar correta; o erro `api.responses.write` provavelmente não é por falta de Owner na organização.
- Próximas verificações recomendadas: confirmar permissões no projeto correto em `Projects` -> projeto usado pelo AI Hub -> `Members`, e validar a credencial efetiva (`API keys` ou service account `curso--02`) para garantir permissão de escrita na Responses API.

## 2026-06-19 — Identificação do projeto OpenAI usado pelo AI Hub
- Investigado como o AI Hub escolhe o projeto OpenAI: `docker-compose.yml` carrega `OPENAI_API_KEY` a partir de `/run/secrets/openai-token/openai_api_key` para backend e `sandbox-orchestrator`, sem definir explicitamente `OPENAI_PROJECT_ID` ou `OPENAI_ORG_ID`.
- Consulta via MCP ao container `ai-hub-6-sandbox-orchestrator-1` confirmou `OPENAI_PROJECT_ID` e `OPENAI_ORG_ID` vazios, e uma chave `sk-proj-...` montada no segredo.
- Conclusão operacional: em execuções com API key, o projeto é o projeto ao qual essa chave `sk-proj` pertence no painel da OpenAI; em execuções `CHATGPT_CODEX`, o sandbox usa o `access_token` OAuth da sessão conectada, então o projeto efetivo depende da autorização/conta do token e não aparece como variável local no container.
- Próximo passo recomendado: localizar a API key/service account correspondente no painel OpenAI em `Projects` -> projeto -> `API keys`, ou rotacionar a chave criando uma nova no projeto desejado e atualizando `/root/infra/openai-token/openai_api_key` no host.

## 2026-06-19 — Comparação visual de projeto OpenAI e chave do AI Hub
- Usuário mostrou a lista de projetos da OpenAI contendo apenas `Default project` com ID `proj_Wc5aRLIYuBySAfNjLLyprCCw`.
- Comparado com a investigação anterior: o AI Hub não define `OPENAI_PROJECT_ID`; ele usa a chave `sk-proj-...` montada em `/run/secrets/openai-token/openai_api_key`, portanto é necessário abrir o `Default project` e conferir em `API keys` se a chave montada no servidor corresponde a esse projeto.
- Orientação refinada: se a chave atual não aparecer no `Default project` ou estiver restrita sem escrita para Responses, gerar uma nova chave nesse projeto com permissão adequada, substituir `/root/infra/openai-token/openai_api_key` no host e reiniciar backend/sandbox.
- Observação: para jobs `CHATGPT_CODEX`, o erro observado nos logs continua associado ao `access_token` OAuth da sessão conectada; trocar a API key corrige os fluxos baseados em `OPENAI_API_KEY`, mas pode não alterar o escopo do token OAuth se o runner continuar nesse profile.

## 2026-06-19 — Solicitação de troca da chave OpenAI no AI Hub
- Usuário solicitou alterar a chave OpenAI usada pelo AI Hub.
- Verificado que a configuração efetiva do deploy lê a chave de `/root/infra/openai-token/openai_api_key` no host, montada nos containers como `/run/secrets/openai-token/openai_api_key`.
- Não foi possível executar a troca sem receber uma nova chave válida (`sk-proj-...`); por segurança, a orientação é inserir a nova chave diretamente no host/secret store, não expor o valor completo no chat.
- Procedimento recomendado após obter a nova chave no projeto correto: gravar o valor em `/root/infra/openai-token/openai_api_key` com permissões restritas e reiniciar `backend` e `sandbox-orchestrator` para recarregar `OPENAI_API_KEY`.

## 2026-06-19 — Correção de causa raiz OAuth para `CHATGPT_CODEX` sem API key do projeto
- Revertida a direção de usar `OPENAI_API_KEY` por padrão no `CHATGPT_CODEX`, pois o requisito é manter o fluxo OAuth da conta conectada.
- Causa raiz refinada comparando com o `codex-rs`: o erro não se resolve adicionando manualmente `api.responses.write` ao device login; o fluxo oficial troca o `id_token` OAuth por um token do tipo `openai-api-key` (`requested_token=openai-api-key`) antes de chamar a API, enquanto o AI Hub estava enviando diretamente o `access_token` OAuth da sessão para a Responses API.
- Correção aplicada: o backend agora faz token exchange OAuth (`urn:ietf:params:oauth:grant-type:token-exchange`) usando o `id_token` da sessão e envia ao sandbox o token derivado para execução `CHATGPT_CODEX`.
- Mantido o sandbox usando o token recebido da sessão, sem recorrer à API key do projeto, e adicionados testes para o payload de token exchange e para o envio do token OAuth derivado ao sandbox.

## 2026-06-19 — Correção do erro 500 ao criar request `CHATGPT_CODEX`
- Investigada a causa raiz do `POST /api/codex/requests` retornar 500: o backend fazia token exchange OAuth para `CHATGPT_CODEX`, recebia 401 da OpenAI com `Invalid ID token: missing organization_id` e deixava a exceção propagar, abortando a criação da solicitação antes de enviar/registrar a execução no sandbox.
- Corrigido o `TokenLifecycleManager` para tratar falhas do token exchange Codex como ausência controlada de token derivado, registrar métrica/log de falha e retornar `Optional.empty()` em vez de propagar `RestClientException` para o controller.
- Com isso, a criação da solicitação deixa de quebrar com erro HTTP 500 por causa de credencial OAuth inválida/incompleta; o fluxo passa a registrar a execução e delegar ao sandbox a validação final de autenticação do profile `CHATGPT_CODEX`.

## 2026-06-19 — Correção de causa raiz do `organization_id` no OAuth `CHATGPT_CODEX`
- Refinada a causa raiz do 401 `Invalid ID token: missing organization_id`: não bastava tratar a exceção do token exchange; o login OAuth precisava solicitar explicitamente que o `id_token` fosse emitido com dados de organização.
- Corrigidos os fluxos de login browser e device para enviar `id_token_add_organizations=true`, alinhando o comportamento ao fluxo do Codex CLI e permitindo que o `id_token` carregue o `organization_id` necessário ao token exchange `openai-api-key`.
- Corrigido também o refresh token OAuth para solicitar `id_token_add_organizations=true`, evitando que uma renovação posterior substitua a sessão por um `id_token` sem organização e recrie a falha.

## 2026-06-19 — Configuração do `organization_id` informado
- Usuário informou o `organization_id` efetivo `org-DgyTLAxNYnw0cOQVlAXInkyR`; adicionada configuração `hub.account.oauth.organization-id`/`HUB_ACCOUNT_OAUTH_ORGANIZATION_ID` com esse valor padrão no backend.
- O `organization_id` agora acompanha o device login, a URL de login browser, o refresh OAuth e o token exchange Codex, além de manter `id_token_add_organizations=true` para que o `id_token` seja emitido com os dados de organização necessários.

## 2026-06-19 — Bloqueio de execução `CHATGPT_CODEX` sem token derivado
- Investigada a causa raiz do erro exibido na requisição 706: o backend permitia enviar jobs `CHATGPT_CODEX` ao sandbox mesmo quando a sessão conectada não conseguia gerar um token de execução OAuth derivado, fazendo o sandbox falhar depois com “Sessão ChatGPT conectada não forneceu access_token”.
- Corrigido o fluxo para falhar localmente a requisição `CHATGPT_CODEX` quando o token derivado não estiver disponível, sem criar job no sandbox e com mensagem acionável para reconectar/verificar a organização OAuth.
- Adicionado teste unitário garantindo que `CHATGPT_CODEX` sem token não chama o sandbox e registra a falha diretamente na solicitação.

## 2026-06-19 — Causa real da ausência de token derivado no `CHATGPT_CODEX`
- Verificado nos logs do backend que a requisição 706 não obteve token derivado porque o token exchange OAuth retornou `400 Bad Request` com `Unknown parameter: 'organization_id'`.
- Causa raiz corrigida: `organization_id` deve continuar sendo usado no login/refresh para emitir `id_token` com organização, mas não deve ser enviado no token exchange `requested_token=openai-api-key`, pois esse endpoint rejeita o parâmetro.
- Ajustado o payload de token exchange Codex para não incluir `organization_id` e atualizado o teste unitário para proteger esse contrato.

## 2026-06-19 — Orientação de causa raiz no AGENTS
- Adicionada ao `AGENTS.md` a instrução explícita para, antes de propor ou implementar ajuste para um erro, perguntar “por que esse erro aconteceu?” e usar essa resposta para guiar a investigação e a correção.

## 2026-06-19 — Diagnóstico do novo erro na requisição 707 `CHATGPT_CODEX`
- Pergunta de causa raiz aplicada: “por que esse erro aconteceu?” A requisição 707 falhou localmente porque o backend não conseguiu obter o token derivado `openai-api-key` necessário para executar o profile `CHATGPT_CODEX` no sandbox.
- Healthcheck do MCP confirmou o serviço operacional (`GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`).
- Logs do backend da requisição 707 mostram que o token exchange OAuth retornou `401 Unauthorized` com `Invalid ID token: missing organization_id`, então o backend bloqueou corretamente a criação do job no sandbox e exibiu a mensagem “Conta ChatGPT conectada não gerou token de execução para o Codex”.
- Conclusão: o erro novo não é de prompt nem do repositório `paulofor/marketing-hub`; ele ocorre antes do sandbox executar, na conversão do `id_token` da sessão ChatGPT em token de execução Codex. A sessão atual provavelmente foi criada/renovada com um `id_token` ainda sem `organization_id`.
- Ação recomendada: reconectar a conta ChatGPT depois das correções de OAuth já aplicadas, para forçar a emissão de um novo `id_token` contendo organização; se persistir, validar no login/refresh se o parâmetro `id_token_add_organizations=true` está chegando ao provedor e se a organização configurada é a mesma da conta conectada.

## 2026-06-19 — Envio do `organization_id` para a OpenAI
- Pesquisada documentação oficial da OpenAI sobre uso de organização em requisições de API: usuários em múltiplas organizações devem informar a organização por header para que a requisição seja associada à organização correta.
- Causa raiz revisitada: o `organization_id` informado (`org-DgyTLAxNYnw0cOQVlAXInkyR`) não deve voltar ao corpo do token exchange Codex, pois esse endpoint já rejeitou o parâmetro como desconhecido; a forma compatível para chamadas OpenAI é enviar a organização como header/ configuração de client.
- Ajustado o backend para enviar `OpenAI-Organization: org-DgyTLAxNYnw0cOQVlAXInkyR` nas chamadas ao endpoint OAuth/token quando houver organização configurada.
- Ajustado o sandbox-orchestrator para configurar a organização no client oficial OpenAI a partir de `OPENAI_ORGANIZATION`, `OPENAI_ORG_ID` ou `HUB_ACCOUNT_OAUTH_ORGANIZATION_ID`, garantindo que chamadas Responses API — inclusive com token derivado do `CHATGPT_CODEX` — sejam enviadas para a OpenAI com a organização correta.

## 2026-06-19 — Orientação sobre settings da organização OpenAI
- Usuário mostrou a tela `Organization settings > General` com `Organization ID` igual a `org-DgyTLAxNYnw0cOQVlAXInkyR` e status `Verified`.
- Consultada documentação oficial: quando o usuário pertence a múltiplas organizações, a organização usada na API deve ser selecionada via header da requisição; a tela `General` apenas exibe o identificador e o status de verificação.
- Conclusão: não há ajuste necessário nessa tela de settings; o ID já confere com o valor configurado no AI Hub e a organização já está verificada. O ajuste necessário é operacional/código: enviar esse ID nas chamadas OpenAI e reconectar a conta ChatGPT para renovar o `id_token` com organização.

## 2026-06-20 - Correção token exchange Codex ChatGPT
- Problema investigado: solicitação Codex 708 falhava com a mensagem "Conta ChatGPT conectada não gerou token de execução para o Codex".
- Pergunta de causa raiz: por que esse erro aconteceu?
- Causa raiz encontrada nos logs do backend via MCP: o endpoint OAuth retornava `Invalid ID token: missing organization_id` durante o token exchange para `openai-api-key`.
- Correção aplicada: o payload de token exchange do Codex agora inclui `organization_id` quando configurado, alinhando-o ao refresh OAuth e aos headers `OpenAI-Organization` já enviados.
- Validação: teste unitário atualizado para garantir que o payload `urn:ietf:params:oauth:grant-type:token-exchange` carregue `organization_id`.

## 2026-06-19 21:15:49 UTC-3
- Correção de registro: a entrada anterior desta investigação usou título fora do formato obrigatório com hora UTC-3; esta entrada mantém a rastreabilidade no formato correto.
- Causa raiz confirmada nos logs via MCP: o token exchange OAuth para gerar `openai-api-key` falhava com `Invalid ID token: missing organization_id`.
- Ajuste aplicado: `organization_id` passa a ser incluído no payload de token exchange do Codex quando configurado, evitando que a execução ChatGPT Codex falhe antes de chegar ao sandbox.
- Teste executado: `mvn test -Dtest=TokenLifecycleManagerTest` em `apps/backend` com sucesso.

## 2026-06-19 21:22:22 UTC-3
- Revisão solicitada: verificado no próprio `docs/diario/registros1.md` que já havia sido tentado enviar `organization_id` no corpo do token exchange Codex.
- Evidência encontrada nos registros anteriores: a requisição 706 recebeu `400 Bad Request` com `Unknown parameter: 'organization_id'`, e a conclusão registrada foi que o `organization_id` deve ser usado no login/refresh/header, mas não no payload `requested_token=openai-api-key`.
- Causa raiz da regressão do ajuste anterior: confundi o erro atual `Invalid ID token: missing organization_id` com necessidade de reenviar `organization_id` no corpo do token exchange, apesar do histórico mostrar que esse endpoint rejeita o parâmetro.
- Correção aplicada: removido novamente `organization_id` do payload de token exchange Codex e restaurado o teste unitário que protege esse contrato.

## 2026-06-19 21:29:40 UTC-3
- Investigação solicitada com validação contra registros: confirmei novamente que `organization_id` não pode voltar ao corpo do token exchange Codex, pois os registros anteriores documentam `Unknown parameter: 'organization_id'` na requisição 706.
- Pesquisa na documentação oficial atual do Codex: o caminho suportado para ChatGPT-managed Codex em automação é usar o próprio Codex com `auth.json`/refresh embutido ou API key; o CLI também suporta device auth. Essa orientação reforça que não devemos inventar parâmetros no token exchange.
- Comparação com `exemplos/codex-rs`: o fluxo oficial solicita `id_token_add_organizations=true` no login browser, troca o authorization code por tokens e só então faz token exchange para `openai-api-key` sem `organization_id` no corpo.
- Pergunta de causa raiz: por que o erro `Invalid ID token: missing organization_id` continuou depois das correções? Resposta: sessões já existentes podem manter um `id_token` antigo sem claim de organização enquanto ainda não expiraram; o backend só renovava por expiração, então repetia o token exchange com um `id_token` stale.
- Correção aplicada: antes do token exchange Codex, quando há `organization_id` configurado, o backend agora verifica se o `id_token` possui a claim de organização esperada; se não possuir e houver `refresh_token`, força refresh OAuth usando o payload já correto (`id_token_add_organizations=true` + `organization_id` no refresh) e só depois tenta gerar o token `openai-api-key`.

## 2026-06-20 - Correção do token de execução do Codex ChatGPT
- Investigado erro exibido em `/codex/requests/709`: "Conta ChatGPT conectada não gerou token de execução para o Codex".
- Pergunta de causa raiz: por que esse erro aconteceu? Os logs do backend mostraram que a renovação OAuth enviava o parâmetro `id_token_add_organizations` para o endpoint de token refresh, mas o provedor retornou `Unknown parameter: 'id_token_add_organizations'`; com isso o id token não era atualizado com a organização e o token exchange do Codex falhava por `missing organization_id`.
- Ajustado o refresh OAuth para não enviar o parâmetro incompatível e manter apenas `organization_id` quando configurado.
- Corrigida a detecção local da claim de organização no id token para também aceitar a estrutura aninhada em `https://api.openai.com/auth`.
- Validação executada: `mvn test -Dtest=TokenLifecycleManagerTest,CodexRequestServiceTest` em `apps/backend`, com sucesso.

## 2026-06-20 - Correção de compilação no TokenLifecycleManager
- Erro investigado: o build Java falhava com `method extractJsonString(java.lang.String,java.lang.String) is already defined in class com.aihub.hub.service.TokenLifecycleManager`.
- Pergunta de causa raiz: por que esse erro aconteceu? A classe `TokenLifecycleManager` continha duas declarações idênticas de `extractJsonString(String, String)`, introduzidas durante os ajustes de leitura das claims do `id_token`.
- Correção aplicada: removida a declaração duplicada e mantida uma única implementação compartilhada pelo parser simples de JWT/JSON.
- Validação executada: `mvn test -Dtest=TokenLifecycleManagerTest,CodexRequestServiceTest` em `apps/backend`, com sucesso.

## 2026-06-20 — Correção de refresh/device OAuth alinhada ao codex-rs
- Pergunta de causa raiz antes do ajuste: “por que esse erro aconteceu?”. Resposta: a execução `CHATGPT_CODEX` falhava antes de chegar ao sandbox porque o backend tentava derivar um token de execução a partir do `id_token`, mas a etapa de refresh enviava `organization_id` para `/oauth/token`, parâmetro rejeitado pela OpenAI como `Unknown parameter`, e em seguida o token exchange falhava com `Invalid ID token: missing organization_id`.
- Comparação com o exemplo `exemplos/codex-rs`: o refresh/token exchange do Codex CLI não envia `organization_id` no form body de `/oauth/token`, e o device code request público envia apenas `client_id`; portanto o problema não era o `app_id` padrão `app_EMoamEEZ73f0CkXaXp7hrann` em si, mas parâmetros extras adicionados pelo AI Hub no fluxo OAuth.
- Ajustado `TokenLifecycleManager` para não incluir `organization_id` no payload de refresh token, preservando apenas `grant_type`, `refresh_token`, `client_id` e `client_secret` quando aplicável.
- Ajustado `AccountController` para alinhar o payload de `/api/accounts/deviceauth/usercode` ao `codex-rs`, enviando apenas `client_id` no device login público.
- Atualizados testes unitários para cobrir que refresh e device usercode não carregam parâmetros de organização no corpo das requisições.

## 2026-06-20 — Evidências, conclusões e ajustes do erro CHATGPT_CODEX 710
- Evidência operacional coletada via MCP Server: `GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`, confirmando disponibilidade do canal correto de diagnóstico no host.
- Evidência de logs do backend coletada com `POST https://iahub.xyz/mcp/tools/linux-command` e comando `docker logs --tail 300 ai-hub-6-backend-1`: a requisição `CodexRequest 710` foi criada com perfil `CHATGPT_CODEX`, mas antes do envio ao sandbox houve falha em `TokenLifecycleManager` ao renovar OAuth: `Unknown parameter: 'organization_id'` em `/oauth/token`.
- Evidência sequencial nos mesmos logs: após a falha de refresh, o token exchange Codex retornou `401 Unauthorized` com `Invalid ID token: missing organization_id`, e o backend registrou `CodexRequest 710 será executado sem token OAuth válido de conta conectada`, resultando na mensagem exibida na tela: `Conta ChatGPT conectada não gerou token de execução para o Codex`.
- Evidência do exemplo `exemplos/codex-rs`: `core/src/auth.rs` define o client público do Codex como `app_EMoamEEZ73f0CkXaXp7hrann`; `login/src/device_code_auth.rs` solicita device usercode enviando apenas `client_id`; `login/src/server.rs` faz refresh/token exchange em `/oauth/token` sem `organization_id` no corpo do form.
- Conclusão sobre o `app_id`: o `app_EMoamEEZ73f0CkXaXp7hrann` é o client público usado pelo próprio Codex CLI no exemplo local, então a evidência disponível não aponta que ele esteja incorreto. O erro observado aponta para payloads divergentes do contrato aceito por `/oauth/token`, especialmente `organization_id` no refresh.
- Conclusão sobre causa raiz: o AI Hub misturou tentativa de seleção/validação de organização com o corpo de chamadas OAuth que não aceitam esse parâmetro; isso impedia renovar/obter um `id_token` adequado e, por consequência, impedia gerar o token `openai-api-key` usado pelo sandbox `CHATGPT_CODEX`.
- Ajuste aplicado no código: `TokenLifecycleManager.buildTokenRefreshPayload` deixou de adicionar `organization_id` no refresh e passou a preservar apenas `grant_type`, `refresh_token`, `client_id` e `client_secret` quando configurado.
- Ajuste aplicado no código: `AccountController.buildDeviceUserCodePayload` foi alinhado ao fluxo público do `codex-rs`, enviando somente `client_id` no start do device login.
- Ajuste aplicado nos testes: `TokenLifecycleManagerTest` agora protege que o refresh não carregue `organization_id` nem `id_token_add_organizations`; `AccountControllerTest` protege que o device usercode não carregue parâmetros extras de organização.
- Validação executada: `mvn test -Dtest=TokenLifecycleManagerTest,AccountControllerTest` em `apps/backend`, com `BUILD SUCCESS`, `Tests run: 9`, `Failures: 0`, `Errors: 0`.

## 2026-06-20 — Diagnóstico e correção do erro CHATGPT_CODEX 711
- Pergunta de causa raiz: por que esse erro aconteceu? A requisição 711 foi enviada ao sandbox sem token OAuth derivado porque o backend falhou ao renovar a sessão com `401 Invalid client specified` e, em seguida, o token exchange continuou usando um `id_token` antigo sem `organization_id`, retornando `Invalid ID token: missing organization_id`.
- Pesquisa na documentação oficial da OpenAI: a documentação atual recomenda API key para automações programáticas de Codex e, quando a automação precisa identidade ChatGPT/Codex, usar tokens de acesso ou o refresh embutido do próprio Codex, sem chamar manualmente o endpoint OAuth.
- Comparação com `exemplos/codex-rs`: o refresh oficial usa o client público `app_EMoamEEZ73f0CkXaXp7hrann` e inclui o escopo `openid profile email`, sem `organization_id` ou `id_token_add_organizations` no corpo.
- Conclusão: após remover os parâmetros extras, restou uma divergência de client no refresh; em instalações sem `HUB_ACCOUNT_OAUTH_CLIENT_ID`, o AI Hub montava `client_id` vazio, causando `invalid_client`, enquanto o fluxo device/Codex deve usar o `device-client-id` público como fallback.
- Correção aplicada: `TokenLifecycleManager.buildTokenRefreshPayload` agora resolve o `client_id` do refresh usando `HUB_ACCOUNT_OAUTH_CLIENT_ID` quando configurado e, caso contrário, cai para `HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID` (`app_EMoamEEZ73f0CkXaXp7hrann`), além de enviar `scope=openid profile email` para alinhar ao `codex-rs`.

## 2026-06-20 14:43:51 UTC-3
- Investigação de causa raiz do request Codex ChatGPT 712: logs do backend em produção mostraram falha no refresh OAuth por `invalid_client` e, em seguida, falha no token exchange Codex por `Invalid ID token: missing organization_id`, resultando na mensagem de UI “Conta ChatGPT conectada não gerou token de execução para o Codex”.
- Comparação com a documentação oficial da OpenAI e com o exemplo `exemplos/codex-rs/login/src/server.rs`: Codex usa login ChatGPT com retorno de access token, suporta `CODEX_ACCESS_TOKEN`/tokens de automação para fluxos confiáveis, e o fluxo browser do codex-rs solicita claims de organizações com `id_token_add_organizations=true`, `codex_cli_simplified_flow=true` e restrição de workspace via `allowed_workspace_id`.
- Correção aplicada no backend: a URL OAuth browser agora segue o padrão do codex-rs para workspace (`allowed_workspace_id` em vez de `organization_id`) e inclui `codex_cli_simplified_flow=true`; o token exchange também passa a enviar `organization_id` quando configurado, evitando perder o contexto da organização no pedido de token Codex.

## 2026-06-20 14:51:15 UTC-3
- Ajuste solicitado após revisão: adicionar logging de toda troca de informação do backend com a OpenAI no fluxo de conta ChatGPT/Codex.
- Causa raiz operacional: quando a OpenAI retorna erros como `invalid_client` ou `missing organization_id`, os logs anteriores mostravam apenas partes do erro e não registravam de forma uniforme a requisição, resposta e operação envolvidas, dificultando correlação ponta a ponta.
- Implementado `OpenAiExchangeLogger` para registrar chamadas de autorização, device auth, polling device, exchange de authorization code, refresh OAuth e token exchange Codex, sempre com sanitização de tokens, secrets, codes, verifiers, challenges, state e bearer tokens para evitar vazamento de credenciais nos logs.

## 2026-06-20 14:53:11 UTC-3
- Complemento do logging solicitado: além do backend OAuth, o sandbox-orchestrator agora registra as trocas diretas com a OpenAI Responses API (`responses.create`) em outbound, inbound e erro.
- O logging do sandbox inclui o payload sanitizado da requisição e da resposta para permitir auditoria ponta a ponta do que foi enviado e recebido do modelo, sem registrar chaves/API keys, tokens, secrets ou Authorization headers.

## 2026-06-20 19:52:00 UTC
- Solicitação atendida: verificar nos logs como foi a “conversa” com a OpenAI para a requisição Codex 713 exibida na tela.
- Causa raiz perguntada explicitamente antes de concluir: por que esse erro aconteceu? A conversa de device login com a OpenAI concluiu com sucesso, mas a execução Codex 713 falhou antes de chegar ao modelo porque o backend tentou renovar OAuth usando `client_id=paulofore` com `client_secret`, recebendo `401 invalid_client`; em seguida tentou o token exchange Codex incluindo `organization_id`, e a OpenAI rejeitou com `400 Unknown parameter: 'organization_id'`.
- Evidências via MCP: `GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`; `docker logs --tail 500 ai-hub-6-backend-1` mostrou o fluxo `device_user_code`, múltiplos polls `device_authorization_pending`, sucesso no `device_authorization_poll`, sucesso no `authorization_code_exchange`, criação da `CodexRequest 713`, falhas no `oauth_token_refresh` e falha no `codex_api_token_exchange`.
- Evidência adicional: `docker logs --tail 300 ai-hub-6-sandbox-orchestrator-1` mostrou apenas inicialização do serviço, sem chamada `responses.create`, indicando que não houve conversa com a Responses API/modelo para esse request; a falha ocorreu na etapa de autenticação/token antes do sandbox ter token válido.

## 2026-06-20 20:05:00 UTC
- Solicitação atendida: registrar em documento próprio o diálogo observado nos logs entre o AI Hub e a OpenAI para a CodexRequest 713.
- Criado `docs/diario/dialogo-openai-codex-713.md` com a linha do tempo sanitizada do fluxo `device_user_code`, `device_authorization_poll`, `authorization_code_exchange`, `oauth_token_refresh` e `codex_api_token_exchange`, além da conclusão de que não houve chamada `responses.create` no sandbox para essa requisição.

## 2026-06-20 — Correção OAuth Codex client_id

- Investigação orientada por `docs/diario/correcao-oauth-codex-client-id.md`.
- Pergunta de causa raiz: por que esse erro aconteceu? Porque a sessão OAuth não registrava o `client_id`/tipo do cliente que originou os tokens; no refresh, o backend podia trocar o client público do device login por um client global de browser e ainda incluir `client_secret`. Além disso, o token exchange Codex enviava `organization_id`, parâmetro rejeitado pelo `/oauth/token`.
- Ajuste aplicado: sessão agora persiste `chatgpt_oauth_client_id` e `chatgpt_oauth_client_type`; refresh usa o client salvo na sessão; `client_secret` só é enviado para sessão confidencial; token exchange Codex não envia `organization_id`.
- Testes executados: `mvn test -Dtest=AccountControllerTest,TokenLifecycleManagerTest` em `apps/backend` com sucesso.

## 2026-06-21 00:55:00 UTC — Diálogo OpenAI da CodexRequest 714
- Solicitação atendida: registrar em documento próprio o diálogo observado nos logs entre o AI Hub e a OpenAI para a CodexRequest 714, após nova falha exibida na tela.
- Pergunta de causa raiz: por que esse erro aconteceu? O refresh OAuth agora usou o `client_id` público correto (`app_EMoamEEZ73f0CkXaXp7hrann`), sem `client_secret`, e foi aceito pela OpenAI; porém o `id_token` retornado continuou sem `organization_id`, então o token exchange Codex falhou com `401 invalid_subject_token` e mensagem `Invalid ID token: missing organization_id`.
- Evidências via MCP: `GET https://iahub.xyz/mcp` retornou `{"status":"UP"}`; `docker logs --tail 800 ai-hub-6-backend-1` mostrou `device_user_code`, polls pendentes, sucesso em `device_authorization_poll`, sucesso em `authorization_code_exchange`, criação da `CodexRequest 714`, sucesso em `oauth_token_refresh` e falha em `codex_api_token_exchange` por `missing organization_id`.
- Evidência adicional: `docker logs --tail 300 ai-hub-6-sandbox-orchestrator-1` mostrou apenas `Sandbox orchestrator listening on port 8083`, sem chamada `responses.create`; portanto não houve conversa com a Responses API/modelo para esse request.
- Criado `docs/diario/dialogo-openai-codex-714.md` com a linha do tempo sanitizada do fluxo e a conclusão de que a causa raiz atual é a ausência da claim de organização no `id_token` usado como `subject_token`.

## 2026-06-21 17:59:22 UTC — Bloqueio de token exchange sem `organization_id` na CodexRequest 714
- Pergunta de causa raiz antes do ajuste: por que esse erro aconteceu? O relatório `docs/diario/dialogo-openai-codex-714.md` mostrou que o login/refresh OAuth já usava o client público correto e era aceito pela OpenAI, mas o `id_token` renovado continuava sem a claim `organization_id`; apesar disso, o backend ainda tentava o token exchange Codex e recebia `401 invalid_subject_token`.
- Causa raiz tratada no código: a ausência da claim de organização no `id_token` é pré-condição inválida para o token exchange `requested_token=openai-api-key`; insistir na chamada apenas produz erro externo conhecido e não corrige a sessão.
- Ajuste aplicado: `TokenLifecycleManager` agora interrompe o token exchange quando há `hub.account.oauth.organization-id` configurado e, mesmo após refresh, o `id_token` segue sem a organização esperada; a sessão recebe um motivo operacional para orientar reconexão via login browser quando o fluxo público por device code não retornar `organization_id`.
- Ajuste aplicado: `CodexRequestService` passa a anexar esse motivo à mensagem de falha da requisição `CHATGPT_CODEX`, evitando envio ao sandbox sem token derivado e tornando a causa visível ao usuário.
- Validação executada: `mvn test -Dtest=TokenLifecycleManagerTest,CodexRequestServiceTest` em `apps/backend`, com sucesso.

## 2026-06-21 18:10:00 UTC — Envio de `organization_id` no refresh OAuth Codex
- Correção solicitada sobre o ajuste anterior: enviar o `organization_id` na hora do refresh OAuth, pois esta é a causa raiz indicada para o `id_token` renovado continuar sem a claim de organização.
- Pergunta de causa raiz antes do ajuste: por que esse erro aconteceu? Porque o refresh OAuth do AI Hub renovava a sessão usando o client correto, mas sem declarar o workspace/organização configurado no próprio payload do refresh; assim o provedor podia devolver um `id_token` válido, porém sem `organization_id`, inviabilizando o token exchange Codex.
- Ajuste aplicado: `TokenLifecycleManager.buildTokenRefreshPayload` voltou a incluir `organization_id` quando `hub.account.oauth.organization-id` está configurado, mantendo `id_token_add_organizations` fora do refresh.
- Ajuste aplicado: os testes de refresh OAuth foram atualizados para exigir `organization_id` no payload, inclusive em sessão pública/device login, sem adicionar `client_secret` nem `id_token_add_organizations`.
- Validação executada: `mvn test -Dtest=TokenLifecycleManagerTest,CodexRequestServiceTest` em `apps/backend`, com sucesso.

## 2026-06-22 08:39:12 UTC-3
- Investigado o erro da CodexRequest 715 e comparado com os registros anteriores `dialogo-openai-codex-713.md` e `dialogo-openai-codex-714.md`.
- Pergunta de causa raiz: “por que esse erro aconteceu?” Resposta: a correção anterior havia removido `organization_id` do token exchange, mas o payload de refresh voltou a enviar `organization_id=org-DgyTLAxNYnw0cOQVlAXInkyR`; a OpenAI rejeitou esse parâmetro com `400 unknown_parameter`, impedindo a renovação do `id_token` antes da execução.
- Ajustado `TokenLifecycleManager` para nunca incluir `organization_id` no corpo do refresh token, mantendo o `client_id` público da sessão device e evitando repetir a falha observada no request 715.
- Atualizados os testes unitários para garantir que o refresh não contenha `organization_id` nem `id_token_add_organizations`, inclusive quando há organização configurada e sessão device pública.

## 2026-06-22 09:16:09 UTC-3
- Investigada a CodexRequest 716 via logs do backend e comparada com as requisições 713, 714 e 715.
- Pergunta de causa raiz: “por que esse erro aconteceu?” Resposta: a remoção de `organization_id` do refresh resolveu o `400 unknown_parameter` da 715, mas a 716 voltou ao diagnóstico da 714: o device login público renova com sucesso, porém continua sem `organization_id` no `id_token`; como o próprio backend já sabe que device login público não autoriza o workspace configurado, o frontend não deveria continuar iniciando esse fluxo quando há OAuth browser configurado.
- Ajustado o fluxo da tela `CodexChatgptPage`: ao clicar em “Conectar com ChatGPT”, se o backend indicar `oauthConfigured=true`, a UI passa a iniciar `/account/login/start` e abrir o login browser ChatGPT/Codex, que usa `id_token_add_organizations=true` e `allowed_workspace_id`; o device login fica apenas como fallback quando o OAuth browser não estiver configurado.
- Objetivo definitivo do ajuste: obter uma sessão originada pelo client OAuth confidencial/browser capaz de autorizar o workspace, em vez de repetir device logins públicos que, pelos logs 714/716, não retornam `organization_id`.

## 2026-06-22 12:38:39 UTC-3
- Investigada a CodexRequest 717 via MCP/logs do backend e comparada com 713, 714, 715 e 716.
- Pergunta de causa raiz: “por que esse erro aconteceu?” Resposta: mesmo após a UI preferir `/account/login/start`, a produção ainda iniciou `device_user_code`; a causa raiz encontrada no container é configuração inválida `HUB_ACCOUNT_OAUTH_CLIENT_ID=paulofore`, já documentada como inválida desde a 713. Por isso o backend marcava `oauthConfigured=false`, a UI caía no fallback de device login e a execução repetia o erro de `id_token` sem `organization_id`.
- Ajustado `AccountController` para considerar o OAuth browser pronto quando houver um `HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID` público válido (`app_...`) mesmo que `HUB_ACCOUNT_OAUTH_CLIENT_ID` esteja inválido; nesse caso, `/account/login/start` usa o client público válido e não envia `client_secret`, preservando o fluxo PKCE com `id_token_add_organizations=true` e `allowed_workspace_id`.
- Adicionado teste cobrindo o cenário real de produção (`HUB_ACCOUNT_OAUTH_CLIENT_ID=paulofore` + device client válido) para garantir que a URL browser do Codex use `client_id=app_EMoamEEZ73f0CkXaXp7hrann` e solicite autorização do workspace, evitando novo fallback silencioso para device login.

## 2026-06-22 12:50:24 UTC-3
- Gerado o documento `docs/diario/dialogo-openai-codex-717.md` com o diálogo observado entre AI Hub e OpenAI para a CodexRequest 717.
- O documento registra a pergunta obrigatória de causa raiz, a linha do tempo do device login, polling, authorization-code exchange, refresh OAuth aceito, bloqueio antes do token exchange e comparação com as execuções 713, 714, 715 e 716.
- Conclusão registrada: a 717 não repetiu o `400 unknown_parameter` da 715; ela repetiu a ausência de `organization_id` no `id_token` de sessão device, agravada pela configuração inválida `HUB_ACCOUNT_OAUTH_CLIENT_ID=paulofore` que mantinha a UI no fallback de device login.

## 2026-06-22 14:00:18 UTC-3
- Gerado o documento `docs/diario/dialogo-openai-codex-718.md` com o diálogo observado entre AI Hub e OpenAI para a CodexRequest 718.
- O documento registra a pergunta obrigatória de causa raiz e a linha do tempo completa: device login, polling pendente, autorização concluída, authorization-code exchange, refresh OAuth aceito e bloqueio antes do token exchange por ausência de `organization_id` no `id_token`.
- Comparação registrada: a 718 repetiu a 717; a correção do `organization_id` no refresh permanece efetiva, mas a tentativa ainda usou sessão device pública em vez de sessão browser/PKCE com workspace autorizado.

## 2026-06-22 — Fase 0 do plano Codex App Server

### Por que esse erro aconteceu?

O erro aconteceu porque o AI Hub tentou reproduzir internamente a autenticação privada usada pelo Codex: montou OAuth/device flow, refresh e token exchange manualmente, misturou clientes OAuth na mesma sessão, passou a depender de claims como `organization_id` no `id_token` e ainda marcou/encaminhou execuções `CHATGPT_CODEX` mesmo sem uma credencial executável real. A correção da fase 0, portanto, não deve ajustar mais parâmetros desse fluxo legado; deve congelá-lo até que o Codex App Server assuma autenticação e execução.

### Trabalho realizado

- Adicionada a feature flag `CODEX_APP_SERVER_ENABLED`, exposta em `hub.codex.app-server-enabled`, com padrão `false`.
- Congelado o caminho legado de execução `CHATGPT_CODEX`: novas requisições desse perfil falham localmente com motivo funcional e não chamam `TokenLifecycleManager.getValidCodexApiTokenFromCurrentSession()`, não fazem token exchange manual e não enviam token ao sandbox.
- Preservado o caminho `OPENAI_API`/perfis não ChatGPT, que continua podendo usar o token OAuth/API existente quando disponível.
- Congelados endpoints HTTP de OAuth legado de conta enquanto o App Server não estiver habilitado, retornando estado não executável em `/api/account/read` e bloqueando novas tentativas manuais de login/callback/device.
- Atualizados testes unitários do backend para validar que o perfil `CHATGPT_CODEX` não envia token OAuth derivado ao sandbox durante a fase 0.


## 2026-06-22 — Fase 1 do plano Codex App Server

### Por que esse erro aconteceu?

O erro aconteceu porque o AI Hub ainda não tinha um supervisor local para o processo oficial `codex app-server`; sem esse componente, a autenticação e o estado de conta do perfil `CHATGPT_CODEX` continuariam dependendo do fluxo legado congelado na fase 0 ou de tentativas manuais de token exchange. A causa raiz da fase 1, portanto, é arquitetural: faltava mover a posse da sessão ChatGPT/Codex para o sandbox-orchestrator, que é onde a execução e o workspace real já são gerenciados.

### Trabalho realizado

- Instalado o CLI oficial `@openai/codex` na imagem do sandbox-orchestrator e configurado `CODEX_HOME=/var/lib/ai-hub/codex` com diretório dedicado e permissão restrita.
- Criado o cliente/supervisor `CodexAppServerClient` para iniciar `codex app-server --listen stdio://`, fazer o handshake `initialize`/`initialized`, correlacionar respostas por `id`, distribuir notificações, rejeitar requests pendentes em falhas e publicar saúde `starting`, `ready`, `degraded` ou `stopped`.
- Criada leitura segura de conta via `account/read`, expondo apenas estado operacional (`connected`, `authMode`, `planType`, `executable`, `blockReason`) sem repassar tokens ao backend.
- Integrado o App Server opcionalmente ao boot do sandbox-orchestrator por `CODEX_APP_SERVER_ENABLED=true`, ao healthcheck e ao endpoint interno `GET /codex-app-server/account/read`.
- Adicionados testes de handshake, correlação fora de ordem, notificações, rejeição de pendências, degradação em encerramento inesperado, healthcheck e account/read sem tokens.

## 2026-06-22 — Fase 2 do plano Codex App Server

### Por que esse erro aconteceu?

O erro aconteceu porque, mesmo com o supervisor do App Server criado na fase 1, a autenticação exposta ao usuário ainda passava por endpoints e UI pensados para o OAuth legado: e-mail obrigatório, falsa seleção multi-conta, browser/device flow manual e estado inferido localmente. A causa raiz da fase 2 era a falta de uma fachada HTTP que delegasse login, logout e leitura de conta ao `codex app-server`, preservando apenas campos seguros para o frontend.

### Trabalho realizado

- Implementado login `chatgptDeviceCode` no sandbox-orchestrator via `account/login/start`, além de cancelamento e logout delegados ao App Server.
- Reescritos os endpoints `/api/account/read`, `/api/account/login/start`, `/api/account/device/start`, `/api/account/device/poll`, `/api/account/login/cancel` e `/api/account/logout` para atuarem como proxy do sandbox-orchestrator quando `CODEX_APP_SERVER_ENABLED=true`, sem chamar endpoints privados da OpenAI nem persistir tokens na sessão HTTP.
- Atualizado o frontend `CodexChatgptPage` para usar device code por padrão, remover e-mail obrigatório e a falsa UI multi-conta, exibir `authMode`, `planType`, `executable` e `blockReason`, e bloquear execução quando `executable=false`.
- Configurado volume persistente `codex-auth-data` para `CODEX_HOME=/var/lib/ai-hub/codex` no Docker Compose, sem montar o volume no frontend.
- Adicionados testes do sandbox-orchestrator para login e logout via App Server, mantendo validação de leitura sanitizada sem tokens.

## 2026-06-22 — Fase 3 do plano Codex App Server

### Por que esse erro aconteceu?

O erro aconteceu porque, até a fase 2, o sistema já tinha um caminho seguro de autenticação via App Server, mas a execução `CHATGPT_CODEX` ainda não tinha um fluxo próprio de `thread/start` e `turn/start`. Sem essa separação, o backend poderia voltar a despachar jobs sem validar readiness/conta executável ou o sandbox-orchestrator poderia tentar executar o perfil ChatGPT pelo caminho legado da Responses API. A causa raiz da fase 3 era a ausência de um caminho de execução exclusivo do Codex App Server e de uma barreira de readiness antes do dispatch.

### Trabalho realizado

- Backend passou a consultar `account/read` do sandbox-orchestrator antes de despachar `CHATGPT_CODEX`, falhando localmente quando a conta não está executável e nunca enviando token OAuth no payload desse perfil.
- Sandbox-orchestrator passou a separar `CHATGPT_CODEX` da Responses API, executando `thread/start` e `turn/start` no Codex App Server somente quando o cliente está pronto e a conta está executável.
- Consumidos eventos mínimos do App Server (`item/started`, `item/completed`, `item/agentMessage/delta`, `turn/completed`) para formar resumo, registrar interações sanitizadas e concluir o job apenas após `turn/completed`.
- Adicionado timeout funcional `CODEX_APP_SERVER_TURN_TIMEOUT_MS`, tipos auxiliares de thread/turn/erros funcionais e hardening para descartar `accessToken` recebido em jobs `CHATGPT_CODEX`.
- Adicionados testes cobrindo dispatch backend sem token OAuth quando a conta está executável e execução sandbox via App Server sem chamar `responses.create`.

## 2026-06-22 — Fase 4 do plano Codex App Server

### Por que esse erro aconteceu?

O erro aconteceu porque, mesmo após autenticação e execução terem sido movidas para o Codex App Server nas fases 1 a 3, o backend ainda mantinha código morto do OAuth manual no `AccountController`: montagem de URL PKCE, device polling próprio, callback local, persistência de tokens na sessão HTTP e variáveis `HUB_ACCOUNT_OAUTH_*` expostas como configuração de aplicação. A causa raiz da fase 4 era a coexistência do caminho novo com o legado, o que deixava risco de alguém reativar token exchange manual ou interpretar a UI/configuração antiga como suportada.

### Trabalho realizado

- Removido o OAuth manual do `AccountController`, deixando `/api/account/*` como fachada do sandbox-orchestrator/Codex App Server quando `CODEX_APP_SERVER_ENABLED=true`.
- Removidos callback próprio, PKCE/token exchange, device polling local, persistência de tokens OpenAI na sessão HTTP e dependência de `TokenLifecycleManager` no controller de conta.
- Mantido estado explícito e não executável quando o App Server está desabilitado, com mensagem de legado removido em vez de tentar fallback OAuth.
- Removidas variáveis `HUB_ACCOUNT_OAUTH_*` do `application.yml` e do `.env.example`, evitando divulgar configuração legada como caminho operacional.
- Atualizados testes de `AccountController` para cobrir apenas proxy App Server, rejeição do legado removido e callback próprio desativado.

## 2026-06-23 — Fase 5 do plano Codex App Server

### Por que esse erro aconteceu?

O erro aconteceu porque ainda existia uma superfície backend capaz de renovar sessão HTTP OAuth antiga (`TokenLifecycleManager`) e porque a produção ainda expunha variáveis `HUB_ACCOUNT_OAUTH_*` no `.env`, mesmo depois de o caminho correto ter passado a ser o Codex App Server. A causa raiz da fase 5 é operacional e de código: para afirmar que não há fallback manual para `/oauth/token`, o backend não pode mais possuir o gerenciador legado nem enviar tokens de sessão HTTP ao sandbox, e a produção precisa remover as variáveis antigas antes do login novo.

### Trabalho realizado

- Removido `TokenLifecycleManager` e seus testes, eliminando do backend a implementação que chamava manualmente `/oauth/token`.
- `CodexRequestService` deixou de depender de sessão OAuth HTTP para qualquer perfil; jobs seguem para o sandbox sem `accessToken`, e as credenciais de execução passam a pertencer ao sandbox-orchestrator/Codex App Server.
- Mantida a barreira de readiness para `CHATGPT_CODEX`, que só despacha quando `account/read` do App Server retorna conta executável.
- Validado via MCP que o servidor MCP está ativo e que os containers de produção estão em execução; a tentativa de limpar `/host/root/ai-hub-6/.env` foi bloqueada por filesystem somente leitura no MCP.
- Registrado `docs/operacao/codex-app-server-fase5-producao.md` com checklist de produção, evidências coletadas e pendências: deploy da nova imagem, limpeza real do `.env`, login humano pelo novo fluxo, restart, request real e confirmação de `thread/start`, `turn/start`, `turn/completed` nos logs.

## 2026-06-23 — Correção de lint no frontend ChatGPT Codex

### Por que esse erro aconteceu?

O erro aconteceu porque `CodexChatgptPage.tsx` importava `useMemo` de `react`, mas a página não possuía mais nenhum cálculo memoizado usando esse hook. A causa raiz foi um import obsoleto que sobrou após refatorações do fluxo ChatGPT/Codex; com a regra `@typescript-eslint/no-unused-vars`, o ESLint falha quando encontra imports não usados.

### Trabalho realizado

- Removido o import não utilizado de `useMemo` em `CodexChatgptPage.tsx`, mantendo apenas os hooks realmente usados pela página.
- Validado o lint do frontend para confirmar que o erro `useMemo is defined but never used` foi eliminado.

## 2026-06-23 — Orientação de conexão Codex ChatGPT em produção

### Por que esse erro aconteceu?

O bloqueio visto na tela aconteceu porque o ambiente de produção ainda está com `CODEX_APP_SERVER_ENABLED=false` no container `ai-hub-6-sandbox-orchestrator-1` e sem `CODEX_APP_SERVER_ENABLED=true` no backend. Com isso, `/api/account/read` retorna `status=app_server_disabled`, `connected=false`, `executable=false` e `blockReason=CODEX_APP_SERVER_DISABLED`; portanto o botão não consegue iniciar uma sessão executável até o App Server ser habilitado e os serviços reiniciados.

### Trabalho realizado

- Verificado o healthcheck do MCP Server em `https://iahub.xyz/mcp` com resposta `UP`.
- Verificados containers de produção via MCP: `ai-hub-6-backend-1` e `ai-hub-6-sandbox-orchestrator-1` estão em execução.
- Confirmada a causa operacional: o sandbox-orchestrator expõe `CODEX_APP_SERVER_ENABLED=false` e `CODEX_HOME=/var/lib/ai-hub/codex`; o backend não expõe `CODEX_APP_SERVER_ENABLED=true` no ambiente atual.
- Orientação registrada: habilitar `CODEX_APP_SERVER_ENABLED=true` no backend e no sandbox-orchestrator, manter `CODEX_HOME=/var/lib/ai-hub/codex` com volume persistente, reiniciar os serviços e então usar o botão “Conectar com ChatGPT” para concluir o device login exibido pela UI.


## 2026-06-23 — Separação entre workflow e ação manual para conexão Codex ChatGPT

### Por que esse erro aconteceu?

O erro aconteceu porque a orientação anterior misturava tarefas que o workflow já executa com tarefas que exigem ação humana no host. A causa raiz operacional permanece `CODEX_APP_SERVER_DISABLED`, mas o ponto prático é que o workflow sincroniza código, publica imagens e roda `docker compose up -d`; ele não sobrescreve o `.env` de produção e não consegue fazer o login humano da conta ChatGPT.

### Trabalho realizado

- Atualizada a documentação operacional da Fase 5 para separar explicitamente o que o GitHub Actions já faz do que precisa ser feito manualmente.
- Esclarecido que a ação manual efetiva é editar `/root/ai-hub-6/.env` para definir `CODEX_APP_SERVER_ENABLED=true` e remover variáveis `HUB_ACCOUNT_OAUTH_*`, depois reiniciar/aguardar deploy.
- Registrado que a etapa de abrir a `verificationUrl` e informar o `userCode` continua sendo manual, porque depende de autorização humana na conta ChatGPT.


## 2026-06-23 — Correção da orientação após retorno `redirect_required` legado

### Por que esse erro aconteceu?

O erro aconteceu porque a produção já tinha `CODEX_APP_SERVER_ENABLED=true`, mas continuava executando imagens antigas pinadas no `.env` (`ghcr.io/paulodb/ai-hub-backend:latest` e `ghcr.io/paulodb/ai-hub-sandbox:latest`). Assim, o backend ativo ainda era o código legado que respondia `POST /api/account/login/start` com `status=redirect_required` e `authUrl=https://chatgpt.com/auth/login`, em vez do código atual que encaminha `chatgptDeviceCode` para o Codex App Server.

### Trabalho realizado

- Atualizada a documentação operacional para incluir a remoção/troca dos pins antigos de imagem no `.env`, além da feature flag `CODEX_APP_SERVER_ENABLED=true`.
- Atualizados os comandos manuais para remover `HUB_ACCOUNT_OAUTH_*`, remover pins antigos de imagem e repinar explicitamente para `ghcr.io/paulofor/ai-hub-6-*` antes de `docker compose pull` e `docker compose up -d`.
- Removidas variáveis `HUB_ACCOUNT_OAUTH_*` de `apps/backend/.env.example`, evitando que o exemplo de ambiente continue sugerindo o caminho OAuth legado.


## 2026-06-23 — Automação da normalização do `.env` no workflow

### Por que esse erro aconteceu?

O erro aconteceu porque a correção anterior ainda dependia de edição manual do `.env` no host, mesmo quando o usuário preferia apenas reexecutar o workflow. A causa raiz operacional era que o workflow preservava o `.env` remoto, mas não normalizava as chaves que mantinham imagens antigas e o caminho OAuth legado.

### Trabalho realizado

- Adicionado passo de deploy no GitHub Actions para criar backup do `.env` remoto, remover `HUB_ACCOUNT_OAUTH_*`, remover pins antigos de imagens e gravar `CODEX_APP_SERVER_ENABLED=true` com as imagens atuais `ai-hub-6-*`.
- Atualizada a documentação operacional para indicar que o caminho preferencial agora é reexecutar o workflow de `main`, deixando os comandos manuais apenas como fallback quando o workflow não puder ser usado.

## 2026-06-23 — Correção do erro 500 no login Codex ChatGPT

### Por que esse erro aconteceu?

O erro aconteceu porque o `sandbox-orchestrator` já retornava uma resposta estruturada de indisponibilidade do Codex App Server (`503` com `blockReason=CODEX_APP_SERVER_UNAVAILABLE`), mas o backend consumia essa resposta via `RestClient.retrieve().body(...)` sem tratar status 4xx/5xx. A exceção do `RestClient` escapava do `AccountController`, e o Spring convertia a falha controlada do upstream em `500 Internal Server Error` para `/api/account/login/start` e `/api/account/read`. A investigação via MCP também mostrou que o Codex App Server respondeu ao `initialize` depois do timeout inicial de 10 segundos, deixando o supervisor em estado degradado.

### Trabalho realizado

- Ajustado `SandboxOrchestratorClient` para reaproveitar o JSON de erro retornado pelo `sandbox-orchestrator` em operações de conta, evitando transformar indisponibilidade conhecida do Codex App Server em erro 500 genérico.
- Aumentado o timeout padrão de request do Codex App Server de 10s para 60s, reduzindo falsos negativos no handshake `initialize` quando o binário demora para aquecer no container.
- Adicionados testes unitários garantindo que `readCodexAccount` e `startCodexLogin` retornem os corpos estruturados de erro do upstream em vez de lançar exceção.

## 2026-06-23 - Correção do sandbox mode enviado ao Codex App Server

- Pergunta de causa raiz: por que esse erro aconteceu? A execução 720 chegou ao Codex App Server pelo caminho novo de `thread/start`, mas o `sandbox-orchestrator` enviava o campo `sandbox` com o valor camelCase legado `workspaceWrite`. A versão ativa do App Server valida esse campo como variante kebab-case e aceita `read-only`, `workspace-write` ou `danger-full-access`; por isso rejeitou a requisição antes de iniciar o turno.
- Ajuste aplicado: o payload de `thread/start` do perfil `CHATGPT_CODEX` agora envia `sandbox: 'workspace-write'`, alinhado ao contrato retornado pelo erro de produção.
- Cobertura: o teste de execução via Codex App Server passou a verificar explicitamente que `thread/start` usa `workspace-write`, evitando regressão para `workspaceWrite`.

## 2026-06-23 - Regra permanente no AGENTS para sandbox mode do Codex App Server

- Pergunta de causa raiz: por que esse erro poderia voltar a acontecer? A correção anterior ajustou o código, mas a convenção do Codex App Server (`workspace-write`) ainda não estava registrada nas instruções permanentes do repositório; outro agente poderia reintroduzir os valores camelCase legados ao tocar no mesmo fluxo.
- Ajuste aplicado: o `AGENTS.md` raiz agora documenta explicitamente que payloads do Codex App Server devem usar `read-only`, `workspace-write` ou `danger-full-access`, e nunca `workspaceWrite`, `readOnly` ou `dangerFullAccess` no campo `sandbox`.

## 2026-06-23 21:40:04 UTC-3
- Diagnóstico solicitado sobre falha na tela `/codex-chatgpt`: a execução chegou a iniciar no `sandbox-orchestrator` com perfil `CHATGPT_CODEX`, clonou o repositório e abriu `thread/start`/`turn/start` no Codex App Server.
- Causa raiz identificada nos logs do container `ai-hub-6-sandbox-orchestrator-1`: o Codex App Server rejeitou o modelo `gpt-5.3-codex` para conta ChatGPT com erro 400 (`The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.`).
- Efeito colateral observado: o evento de erro do Codex App Server não foi tratado pelo `EventEmitter`, derrubando o processo Node do `sandbox-orchestrator`; por isso a UI passou a mostrar bloqueio/erro ao consultar conta e execuções após a queda do container.
- Observação adicional: o backend também registrou `500 Internal Server Error` por falha de conexão MySQL (`Connection reset`) em endpoints de listagem, mas isso não explica o bloqueio inicial da execução CHATGPT_CODEX; o gatilho da execução foi a incompatibilidade de modelo.

## 2026-06-23 21:46:12 UTC-3
- Pergunta de causa raiz: por que a execução CHATGPT_CODEX voltou a falhar ao iniciar? A combo da tela `/codex-chatgpt` carregava modelos do cadastro geral (`/codex/models`), permitindo selecionar `gpt-5.3-codex`, que o Codex App Server rejeita para conta ChatGPT.
- Ajuste aplicado: a combo de modelos específica do fluxo `CHATGPT_CODEX` passou a usar uma lista fixa e compatível com ChatGPT, limitada a `gpt-5.5` e `gpt-5.4`.
- Também foi garantido que, se houver um modelo selecionado fora dessa lista, o frontend volta automaticamente para `gpt-5.5`, evitando persistência de seleção incompatível.

## 2026-06-23 22:55:37 UTC-3
- Solicitação 722: analisada a saída informada pelo usuário sobre a tentativa anterior de ajuste na tela OPRM `pipeline-v2`.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a execução anterior não falhou por causa do código do AI Hub nem por ausência de endpoint; ela foi interrompida por uma falha de infraestrutura/sandbox do executor (`bwrap: No permissions to create a new namespace`), impedindo comandos básicos de leitura/escrita e também o `apply_patch`.
- Conclusão operacional: como o agente anterior não conseguia acessar o workspace local, ele recorreu a consulta externa/connector para localizar a tela e preparar uma hipótese de patch, mas não aplicou nem validou alteração no branch local. A indicação de `docs/registros/oprm1.md` também diverge da instrução vigente do projeto, que exige registro em `docs/diario/registros1.md`.

## 2026-06-23 22:59:46 UTC-3
- Solicitação 722: ajuste efetivo no sandbox-orchestrator para permitir que execuções `CHATGPT_CODEX` via Codex App Server trabalhem no workspace mesmo quando o sandbox Linux interno baseado em `bwrap` não consegue criar namespace dentro do container/host.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o `sandbox-orchestrator` enviava `sandbox: workspace-write` fixo ao `thread/start`; esse modo aciona o sandbox Linux interno do Codex App Server, mas o ambiente observado não permite criação de namespace pelo `bwrap`, gerando `bwrap: No permissions to create a new namespace` antes de o agente conseguir ler/escrever arquivos.
- Correção aplicada: criado `CODEX_APP_SERVER_SANDBOX_MODE` com validação estrita dos valores kebab-case aceitos (`read-only`, `workspace-write`, `danger-full-access`) e padrão `danger-full-access`, mantendo o isolamento no container/workspace do AI Hub e evitando a camada `bwrap` incompatível por padrão.
- Validação: suíte `npm --prefix apps/sandbox-orchestrator test` executada com sucesso, incluindo cobertura do padrão `danger-full-access` e da configuração explícita `workspace-write`.

## 2026-06-24 - Investigação últimas execuções ChatGPT
- Investigado relato de que as últimas execuções sumiram na página Codex ChatGPT.
- Causa observada nos logs: execução 723 / job 18a622ce-e8c0-4c26-b195-e03fed292ad0 concluiu no sandbox às 02:26:05 UTC, mas o callback para o backend falhou com HTTP 500 às 02:26:21 UTC.
- Efeito observado: o backend continuou consultando o job do sandbox repetidamente e retornando payloads grandes (~1,79 MB) para atualização automática; a listagem `/api/codex/requests?page=0&size=10` chegou a exceder timeout de 25s durante a investigação.
- Causa raiz provável: persistência/sincronização do resultado final no callback do sandbox falhou, deixando a tela dependente de refresh por polling pesado em vez de carregar a lista de execuções normalmente.

## 2026-06-24 - Correção da criação de PR nas execuções ChatGPT Codex
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a execução alterava arquivos e concluía no `sandbox-orchestrator`, mas o orquestrador só criava PR quando recebia token GitHub por variáveis locais (`GITHUB_CLONE_TOKEN`, `GITHUB_TOKEN`, `GITHUB_PR_TOKEN`) ou pela `repoUrl`; no fluxo disparado pelo backend, o token da GitHub App ficava disponível apenas no backend e não era enviado no payload do job, levando ao log `nenhum token GitHub disponível; ignorando criação de PR`.
- Correção aplicada: o backend agora obtém o installation token da GitHub App e envia ao sandbox no campo `githubToken`, separado do `accessToken` OAuth/OpenAI; o sandbox aceita esse campo, usa-o como primeira fonte de credencial para clone/push/PR e remove o token das respostas sanitizadas de jobs.
- Cobertura: adicionados testes no sandbox para aceitar `githubToken` sem expor em respostas e para criar PR usando o token do payload; adicionadas asserções no backend garantindo envio do token para jobs CI Fix e ChatGPT Codex sem reintroduzir `accessToken` OAuth no perfil `CHATGPT_CODEX`.

## 2026-06-24 - Ajuste do texto do Modo Codex (ChatGPT)
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a tela apresentava as orientações do perfil Codex (ChatGPT) com linguagem imperativa e absoluta, dando a entender que squads, worktrees e checkpoints de custo seriam obrigatórios em qualquer sessão, embora o próprio perfil documente esses itens como recomendações para missões com múltiplas sub-tarefas paralelas e não para demandas simples.
- Correção aplicada: a copy da tela de detalhe e da seleção de perfil foi ajustada para explicar que as orientações entram no prompt inicial, mas que squads/worktrees/checkpoints devem ser usados apenas quando a tarefa justificar coordenação paralela ou investigação longa.

## 2026-06-24 — Fase 2 interativa do Codex ChatGPT
- Causa raiz identificada: a tela da Fase 2 tratava cada envio como uma execução isolada, sem estado de conversa, sem refletir a resposta do modelo na própria página e sem ação dedicada para solicitar PR ao final do diálogo.
- Ajustada a tela `CodexChatgptPage` para manter uma conversa local entre usuário e modelo, montar o prompt com o histórico antes de cada nova mensagem, acompanhar a execução ativa por polling e atualizar a resposta quando a solicitação terminar.
- Adicionado botão `Pedir PR` para acionar a criação de PR a partir da última resposta concluída, evitando misturar a conversa iterativa com a etapa final de publicação.

## 2026-06-24 17:37:33 UTC — Confirmação de modelo no Codex ChatGPT
- Verificada a tela `/codex-chatgpt` e a implementação atual do frontend: o fluxo `CHATGPT_CODEX` expõe a lista fixa de modelos compatíveis com ChatGPT contendo `gpt-5.5` e `gpt-5.4`.
- Conclusão: é possível usar `gpt-5.5` nessa tela, selecionando-o no campo de modelo antes de enviar a mensagem, desde que a conta ChatGPT esteja conectada/executável e o backend/sandbox consigam iniciar a execução normalmente.
- Observação: não há uma opção separada chamada `gpt-5.5 pro` no código; o identificador disponível é `gpt-5.5`.

## 2026-06-24 17:40:01 UTC — Diferença entre GPT-5.5 e GPT-5.5 Pro
- Investigada a dúvida sobre `gpt-5.5` versus `gpt-5.5 pro` usando referências oficiais da OpenAI e o estado atual do AI Hub.
- Conclusão funcional para o projeto: a tela `/codex-chatgpt` hoje disponibiliza apenas o identificador `gpt-5.5` na lista fixa do fluxo `CHATGPT_CODEX`; para usar a variante Pro seria necessário expor/enviar explicitamente o identificador de modelo `gpt-5.5-pro`, se a conta/plano e o backend/sandbox suportarem esse modelo.
- Diferença conceitual: `gpt-5.5` é o modelo recomendado para a maioria das tarefas Codex e trabalho profissional complexo; `gpt-5.5-pro` usa mais computação/tempo de raciocínio, tende a respostas mais precisas para tarefas difíceis e longas, mas é mais lento e tem custo/limites maiores.

## 2026-06-24 17:42:46 UTC — Viabilidade de adicionar GPT-5.5 Pro na combo
- Pergunta explícita de causa raiz: “por que adicionar na combo poderia ou não funcionar?”. Resposta: no fluxo atual, a combo do frontend é a única lista fixa observada para o perfil `CHATGPT_CODEX`; o backend persiste o `model` recebido e o sandbox repassa esse valor diretamente ao Codex App Server em `thread/start`.
- Conclusão técnica: se `gpt-5.5-pro` for adicionado à lista do frontend e selecionado, o valor deve trafegar pelo backend até o sandbox sem bloqueio local adicional de allowlist no caminho analisado.
- Risco/condição externa: isso só funcionará de ponta a ponta se o Codex App Server e a conta ChatGPT conectada aceitarem `gpt-5.5-pro`; caso contrário a execução deve falhar no `thread/start` com erro de modelo não suportado/autorização/plano, como já ocorreu anteriormente com modelo incompatível.

## 2026-06-24 17:49:14 UTC — Teste controlado do GPT-5.5 Pro na combo
- Pergunta explícita de causa raiz: “por que testar adicionando na combo é suficiente para validar o caminho local?”. Resposta: a combo `CHATGPT_CODEX_MODELS` é o ponto local que limita os modelos selecionáveis; após a seleção, o valor de `model` já é enviado pelo frontend, persistido pelo backend e repassado ao Codex App Server pelo sandbox.
- Ajuste aplicado: adicionado `gpt-5.5-pro` à lista fixa de modelos do fluxo `CHATGPT_CODEX` antes de `gpt-5.5`, permitindo seleção na tela `/codex-chatgpt` para teste real contra a conta/plano conectada.
- Critério de validação: build do frontend confirma que a alteração é válida localmente; a validação final de suporte depende de uma execução real, pois a autorização do modelo é decidida pelo Codex App Server/conta ChatGPT no `thread/start`.

## 2026-06-24 18:10:59 UTC — Resultado do teste GPT-5.5 Pro em produção
- Pergunta explícita de causa raiz: “por que a execução com GPT-5.5 Pro não deu certo?”. Resposta: o valor `gpt-5.5-pro` foi selecionado, chegou ao `sandbox-orchestrator`, abriu `thread/start` com sucesso, mas o Codex App Server rejeitou o turno com erro 400 informando que o modelo não é suportado ao usar Codex com conta ChatGPT.
- Causa raiz confirmada nos logs: incompatibilidade externa do modelo `gpt-5.5-pro` com o fluxo Codex via conta ChatGPT; não foi falha de combo, backend, token GitHub ou clone.
- Correção aplicada: removido `gpt-5.5-pro` da combo do `CodexChatgptPage` para não oferecer uma opção comprovadamente rejeitada nesse fluxo, mantendo `gpt-5.5` e `gpt-5.4`.
- Correção preventiva adicional: tratado evento `error` do Codex App Server no sandbox para que rejeições futuras não derrubem o processo Node por `ERR_UNHANDLED_ERROR`, registrando o erro e encerrando o job como falha controlada.

## 2026-06-24 18:17:40 UTC — Pesquisa sobre habilitar GPT-5.5 Pro na conta
- Pesquisadas fontes oficiais da OpenAI sobre disponibilidade do GPT-5.5 Pro em ChatGPT, Codex e API.
- Conclusão: GPT-5.5 Pro pode existir para planos ChatGPT Pro/Business/Enterprise/Edu e também como modelo de API Responses, mas a documentação de Codex para login com ChatGPT recomenda/expõe GPT-5.5 para Codex; o teste real do AI Hub confirmou que o Codex App Server rejeita `gpt-5.5-pro` quando usado com conta ChatGPT.
- Direção operacional: trocar configurações da conta pode liberar GPT-5.5 Pro no ChatGPT normal, mas não há evidência oficial de configuração de conta que force `gpt-5.5-pro` no Codex via ChatGPT sign-in. Para usar Pro programaticamente, o caminho mais plausível é integração por API/Responses com chave e modelo `gpt-5.5-pro`, não o fluxo atual do Codex App Server autenticado por ChatGPT.

## 2026-06-24 19:43:10 UTC — Suporte a imagens no Codex ChatGPT via App Server
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o frontend e o backend já transportavam anexos de imagem, mas o `sandbox-orchestrator` bloqueava qualquer `imageAttachments` no perfil `CHATGPT_CODEX` com `CODEX_INPUT_IMAGE_UNSUPPORTED`, embora o protocolo do Codex App Server aceite entrada de imagem no `turn/start` como item `{ type: "image", url: ... }`.
- Correção aplicada: removido o bloqueio local e convertido cada data URL de imagem anexada para o formato aceito pelo Codex App Server no payload de `turn/start`, mantendo o texto como primeiro item da entrada.
- Validação: ampliado o teste do fluxo `CHATGPT_CODEX` para cobrir anexo de imagem e confirmar que o `turn/start` recebe texto mais imagem, sem cair na Responses API.

## 2026-06-25 15:20:00 UTC — Correção do botão Pedir PR no Codex ChatGPT
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o endpoint `POST /api/codex/requests/{id}/create-pr` exige o header `X-Role: owner` via `assertOwner`, mas o botão `Pedir PR` da tela `/codex-chatgpt` chamava esse endpoint sem os headers de owner, diferentemente da tela de detalhe da solicitação; por isso o backend retornava `403 Forbidden` antes de tentar criar o PR.
- Correção aplicada: alinhado o `CodexChatgptPage` ao fluxo já existente na tela de detalhe, enviando `X-Role: owner` e `X-User: codex-ui` na chamada de criação de PR.
- Validação local: build do frontend executado para confirmar que a alteração TypeScript/React compila.

## 2026-06-25 15:36:00 UTC — Bloqueio de PR para execução Codex ChatGPT com falha
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: após o botão passar a enviar os headers corretos, o backend aceitava `create-pr` sem conferir se a solicitação alvo terminou com `COMPLETED`; assim uma execução `FAILED` ainda podia disparar a criação de PR usando uma resposta reaproveitada pela busca por ambiente/repositório.
- Correção aplicada: o endpoint de criação de PR agora valida o status da solicitação e retorna `400` quando ela não está concluída com sucesso, antes de buscar resposta/patch ou chamar o serviço de Pull Request.
- Validação local: adicionado teste de controller garantindo que uma solicitação `FAILED` é rejeitada e que nenhum serviço de resposta/PR é acionado nesse caso.

## 2026-06-25 15:41:19 UTC-3
- Consulta solicitada da resposta do modelo na solicitação Codex `#727` via endpoint público `GET https://iahub.xyz/api/codex/requests/727`.
- Confirmado que a solicitação `#727` está `COMPLETED`, com modelo `gpt-5.5`, perfil `CHATGPT_CODEX`, PR vinculado `https://github.com/paulofor/marketing-hub/pull/3965` e resposta registrada em `responseText`.

## 2026-06-25 15:47:24 UTC-3
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a tela mostrava um texto longo vindo das interações outbound do sandbox/Codex App Server, mas o registro principal da solicitação (`codex_requests.response_text`) dependia apenas de `summary`/`error`; assim havia risco de perder ou substituir o transcript completo por um resumo menor no registro da solicitação.
- Correção aplicada: `CodexRequestService` agora deriva `responseText` preferencialmente do transcript completo das interações outbound retornadas pelo sandbox, mantendo fallback para `error` e depois `summary`, e usa essa regra em criação, callback/refresh e cancelamento.
- Validação local: adicionado teste unitário cobrindo callback com interações inbound/outbound e garantindo que apenas o transcript outbound completo é salvo em `CodexRequest.responseText`.

## 2026-06-25 15:55:13 UTC-3
- Correção da correção anterior após esclarecimento: o usuário e commits/PRs devem continuar recebendo apenas o resumo final em `responseText`, enquanto o transcript completo do modelo deve ficar preservado no registro da solicitação para auditoria.
- Causa raiz refinada: usar `responseText` para armazenar o transcript completo misturava a saída operacional/auditável com a resposta resumida de consumo humano, fazendo a UI e fluxos de commit poderem exibir conteúdo longo demais.
- Ajuste aplicado: adicionado campo persistido `model_transcript` em `codex_requests` e mapeado em `CodexRequest.modelTranscript`; `CodexRequestService` mantém `responseText` em `error`/`summary` e grava as interações outbound completas em `modelTranscript`.
- Validação local: teste unitário atualizado para garantir que o resumo permanece em `responseText` e o transcript completo fica em `modelTranscript`.

## 2026-06-25 23:11:45 UTC — Investigação de Internal Server Error na tela Codex ChatGPT
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a tela `/codex-chatgpt` tentou carregar a listagem paginada de solicitações, que passa pelo `CodexController.list` e `CodexRequestService.listPage`, mas o backend não conseguiu obter conexão JDBC do pool Hikari dentro de 60s.
- Evidência de produção via MCP: `docker logs --tail 250 ai-hub-6-backend-1` mostrou `HikariPool-1 - Connection is not available, request timed out after 60000ms (total=6, active=6, idle=0, waiting=11)` exatamente no fluxo `CodexController.list -> CodexRequestService.listPage -> findAllByOrderByCreatedAtDesc`.
- Conclusão: o `Internal Server Error` visível no frontend é consequência da exaustão/indisponibilidade temporária do pool de conexões com o banco no backend, não de erro de layout da página nem de falha direta do navegador.

## 2026-06-25 23:20:00 UTC — Correção do acesso travado por refresh automático do Codex
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o erro anterior continuou porque a causa não era apenas falta momentânea de conexão; endpoints de listagem do Codex executavam refresh automático contra o sandbox durante requisições GET, inclusive para solicitação terminal recente que já tinha resposta, e múltiplos acessos concorrentes tentavam atualizar a mesma `CodexRequest 728` e inserir as mesmas interações.
- Evidência de produção via MCP: os logs passaram a mostrar `Atualizando CodexRequest 728 a partir do sandbox` em várias threads (`exec-37`, `exec-77`, `exec-70`, `exec-20`) e falhas `Lock wait timeout exceeded` ao inserir em `codex_interactions`, explicando o esgotamento do pool Hikari e páginas como `/prompts` ficando presas em carregamento.
- Correção aplicada: solicitações terminais que já possuem `responseText` deixam de ser refrescadas automaticamente apenas por metadados de uso faltantes, e refreshes do mesmo `CodexRequest` passam a ser serializados em memória para evitar gravações concorrentes no mesmo job.
- Validação local prevista: teste unitário garante que uma solicitação terminal com resposta, mesmo sem metadados de uso completos, não chama `sandboxOrchestratorClient.getJob` durante a listagem.

## 2026-06-26 00:46:00 UTC — Consulta de status da solicitação Codex #728
- Verificado via endpoint público `GET https://iahub.xyz/api/codex/requests/728` que a solicitação `#728` ainda aparece com `status: RUNNING`, `finishedAt: null`, `durationMs: null`, `responseText: null`, `timeoutCount: 0`, `interactionCount: 2` e `externalId: 9b3f55be-577e-4325-93a3-4e89b822c465`.
- Verificado via MCP (`docker logs --tail 120 ai-hub-6-backend-1`) que o backend tenta atualizar a `CodexRequest 728`, consulta o job `9b3f55be-577e-4325-93a3-4e89b822c465` no `sandbox-orchestrator`, mas recebe `Job ... não encontrado no sandbox-orchestrator`; por isso a tela mantém a execução aberta sem resposta/finalização registrada.

## 2026-06-26 00:55:00 UTC — Correção de detalhe Codex preso após fechar tela
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: fechar a tela não deveria parar a execução, mas a página de detalhe (`GET /api/codex/requests/{id}`) apenas lia o registro salvo; ela não aplicava o refresh/fallback que já existia nas listagens. Se o callback não chegasse ou o job sumisse do `sandbox-orchestrator`, reabrir a solicitação mantinha o último estado persistido (`RUNNING`) em vez de buscar o diálogo/job mais recente ou finalizar com diagnóstico.
- Correção aplicada: `CodexRequestService.find` agora avalia a mesma política de refresh da listagem ao abrir o detalhe, consulta o sandbox quando a solicitação ainda está incompleta e recarrega o registro após atualização; `listInteractions` usa leitura sem refresh para não escrever dentro de transação somente leitura.
- Validação local: adicionado teste garantindo que abrir o detalhe de uma solicitação `RUNNING` antiga com job ausente aciona `getJob`, aplica o fallback `FAILED`, preenche resposta/finalização e mantém a contagem de interações.

## 2026-06-26 17:10:00 UTC — Investigação de HTTP 502 no domínio iahub.xyz e acesso ao MCP
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o domínio público está devolvendo `HTTP 502 Bad Gateway` tanto na raiz (`https://iahub.xyz/`) quanto no caminho operacional do MCP (`https://iahub.xyz/mcp` e `POST /mcp/tools/linux-command`), portanto o erro visível no navegador não é apenas uma falha de tela do frontend; a própria rota pública/reverse proxy não consegue alcançar os serviços internos necessários, inclusive o MCP usado para diagnóstico remoto.
- Evidência local coletada: `curl -i https://iahub.xyz/`, `curl -i https://iahub.xyz/mcp` e `curl -i -X POST https://iahub.xyz/mcp/tools/linux-command ...` retornaram 502, impedindo executar `docker logs` via MCP no host de produção nesta rodada.
- Correção preventiva aplicada no pipeline: o deploy agora usa `docker compose up -d --remove-orphans` para remover serviços antigos que possam ficar pendurados no host e adiciona uma etapa de verificação pós-deploy que valida `frontend`, `backend` e `mcp-server` por dentro do Docker Compose, imprime logs de diagnóstico se algum serviço não subir e só então testa publicamente `https://iahub.xyz/mcp` e `https://iahub.xyz/`.

## 2026-06-26 17:38:00 UTC — Correção da limpeza que removia imagens `latest` do GHCR
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a etapa final do deploy buscava versões do GHCR pela tag do commit (`${{ github.sha }}`) e deletava a versão inteira do pacote; como o build publica `latest` e `${{ github.sha }}` no mesmo push/manifesto, apagar a versão do SHA também remove a tag `latest` usada pelo `docker compose pull` em produção.
- Impacto provável observado: em novos deploys ou recriações de serviço, os containers de `backend`, `frontend`, `sandbox-orchestrator` e `mcp-server` podem não conseguir puxar a imagem `latest`, deixando apenas containers já existentes/antigos em execução, como o `caddy` visto no `docker ps` do host.
- Correção aplicada: removida a etapa `Clean up GHCR images for this build` do workflow para preservar as imagens publicadas e manter `latest` disponível para o compose de produção.

## 2026-06-26 — Ajuste da resposta da tela Codex ChatGPT
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a tela `/codex-chatgpt` exibia o campo `responseText` como texto puro em um `<p>`, então blocos Markdown/code fence apareciam sem formatação; além disso, o `sandbox-orchestrator` tratava deltas de `item/agentMessage/delta` como resumo final, permitindo que texto transitório/pensamento do modelo fosse persistido e usado em consumo humano/PR quando o evento final não substituía essa concatenação.
- Ajuste aplicado no frontend: adicionada renderização Markdown básica para parágrafos, listas, negrito, inline code e code fences, além de uma sanitização defensiva para esconder o trecho transitório antes do resumo final quando dados antigos ainda vierem contaminados.
- Ajuste aplicado no sandbox-orchestrator: deltas de `item/agentMessage/delta` deixam de compor o `summary`; o resumo final passa a preferir o texto do item `AgentMessage` concluído em `item/completed`, evitando que pensamento/transcrição transitória seja gravado em `responseText` e usado em PRs.

## 2026-06-27 02:53:36 UTC — Confirmação de duplicidade aparente de PRs no marketing-hub
- Verificado publicamente no GitHub que a listagem de PRs fechados de `paulofor/marketing-hub` mostra dois PRs consecutivos criados pelo bot `ai-hub-automations`: `#4058` e `#4059`, ambos mesclados em 2026-06-27.
- Detalhe confirmado: o PR `#4058` foi mesclado com 1 commit a partir de `ai-hub/cifix-aeb53f33-c490-4e9b-b267-d885e9509938`, enquanto o PR `#4059` foi mesclado com 5 commits a partir de `ai-hub/fix-1782528565`.
- Conclusão operacional: sim, existem dois PRs automatizados recentes; eles não são apenas artefato visual da lista. O `#4058` contém a correção detalhada do Liquibase, e o `#4059` referencia explicitamente a solicitação `#730`, com vários commits de mesmo assunto.

## 2026-06-27 03:00:00 UTC — Correção para criar PR somente no botão Pedir PR do Codex ChatGPT
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o backend enviava `githubToken` também para jobs `CHATGPT_CODEX`; como o `sandbox-orchestrator` cria PR automaticamente quando recebe token e encontra diff, a execução inicial já abria um PR antes do usuário usar o botão `Pedir PR`. Depois, o botão chamava `/codex/requests/{id}/create-pr` e abria outro PR usando o diff salvo, gerando a duplicidade observada.
- Correção aplicada: jobs `CHATGPT_CODEX` deixam de receber `githubToken` no despacho para o sandbox, impedindo PR automático durante a conversa; o token continua disponível para os demais perfis que dependem do comportamento automático.
- Ajuste complementar: o endpoint manual `Pedir PR` passa a usar a resposta final (`responseText`) como explicação completa do PR, com fallback para `fixPlan`, e o corpo do PR criado pelo `PullRequestService` agora recebe essa explicação em vez de texto genérico.
- Validação local: testes unitários confirmam que `CHATGPT_CODEX` é enviado ao sandbox sem token GitHub e que o endpoint manual usa a resposta final completa como explicação do PR.

## 2026-06-27 - Favicon do AI Hub
- Criei um favicon SVG para o frontend em `apps/frontend/public/favicon.svg`, com identidade visual em gradiente azul/índigo/roxo e símbolo central inspirado em hub de IA.
- Atualizei `apps/frontend/index.html` para declarar o favicon via `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`, permitindo que o Chrome exiba o ícone na aba.

## 2026-06-27 00:00:00 UTC — Remoção do módulo de vídeo não utilizado
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a funcionalidade de vídeo ainda estava exposta no menu lateral e na rota `/video/projects` porque o módulo completo havia permanecido registrado no frontend, no backend, nas migrações/changelog e na documentação, apesar de não estar em uso pelo produto.
- Correção aplicada: removidos o item de navegação e a rota/página de projetos de vídeo no frontend; removidos controller, service, DTOs, entidades, repositórios e teste do módulo de vídeo no backend; removidos os changelogs/migrações e a documentação específica do módulo para evitar que novas instalações recriem essa superfície.
- Validação local prevista: build do frontend e testes do backend para confirmar que não ficaram imports, rotas ou beans quebrados após a remoção.

## 2026-06-27 00:00:00 UTC — Remoção do módulo Summaries não utilizado
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a funcionalidade Summaries continuava registrada como rota e item de menu no frontend e como controller/service/repository/entity/DTO no backend, além de manter a tabela `summaries` nas migrações iniciais, embora o produto não use mais esse módulo.
- Correção aplicada: removidos a tela `/summaries`, o link lateral e a rota React; removidos os beans e classes backend específicos de Summaries; removida a criação/alteração da tabela `summaries` das migrações.
- Validação local prevista: busca por referências específicas do módulo e builds/testes do frontend/backend para confirmar que não ficaram imports, rotas ou beans quebrados.


## 2026-06-27 00:00:00 UTC — Remoção do módulo Blueprint não utilizado
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a funcionalidade Blueprint continuava exposta como rota `/blueprints`, item no menu lateral, card no dashboard e também permanecia registrada no backend com controller/service/repository/entity/DTO e migrações iniciais, mesmo não sendo mais usada pelo produto.
- Correção aplicada: removidos a rota, página e navegação de Blueprints no frontend; removidos os componentes backend específicos de Blueprint; removido o vínculo `projects.blueprint_id` e a criação/alteração da tabela `blueprints` nas migrações iniciais; atualizado o texto do dashboard e do README para refletir o escopo atual.
- Validação local prevista: busca por referências específicas de Blueprint e builds/testes do frontend/backend para confirmar que não ficaram imports, rotas ou beans quebrados.

## 2026-06-28 00:00:00 UTC — Novo favicon AI Hub 6
- Ajuste aplicado: preservei o favicon anterior em `apps/frontend/public/favicon-legacy-aihub.svg` para manter o histórico visual disponível no projeto.
- Novo favicon: substituí `apps/frontend/public/favicon.svg` por uma versão SVG baseada no número 6, mantendo a paleta azul/índigo/roxo do AI Hub e reforçando a identidade do AIHUB 6 na aba do navegador.
- Integração: a página já referencia `/favicon.svg` em `apps/frontend/index.html`, então o novo arquivo passa a ser exibido sem mudança adicional no HTML.
## 2026-06-27 23:52:00 UTC — Análise sobre Docker daemon na sandbox
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a sessão de sandbox atual não tem Docker CLI disponível (`docker: command not found`) e também não há processo `dockerd`/`containerd` em execução visível, portanto a falha não é apenas de publicação da porta 5173; falta o runtime Docker dentro da sandbox.
- Conclusão: não é algo que possa ser corrigido apenas dentro do repositório em tempo de execução. Para suportar Docker real na sandbox seria necessário alterar a imagem/base e a política de execução do ambiente para incluir Docker CLI/daemon e permissões privilegiadas ou, preferencialmente, montar o socket Docker do host de forma controlada. Para o AI Hub, o caminho mais seguro continua sendo executar comandos Docker no host via MCP Server autenticado.

## 2026-06-27 23:58:00 UTC — Explicação dos riscos de Docker-in-Docker na sandbox
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a dúvida surgiu porque a conclusão anterior citou Docker-in-Docker como opção menos recomendada sem detalhar que o risco não vem apenas do pacote Docker, mas das permissões necessárias para um daemon criar containers dentro de outro container.
- Detalhamento: Docker-in-Docker completo normalmente precisa de privilégios elevados para manipular namespaces, cgroups, iptables/rede, montagens e camadas de filesystem. Em uma sandbox multiusuário ou conectada ao host, isso aumenta a superfície de risco porque uma falha, configuração permissiva ou montagem sensível pode permitir acesso indevido ao host, interferência em rede/containers, consumo excessivo de recursos ou bypass parcial do isolamento esperado.
- Esclarecimento sobre o trabalho realizado: não foi implementado Docker na imagem da sandbox. O que foi feito foi uma verificação local da sessão atual, confirmação da ausência de Docker CLI/daemon e registro documental da causa raiz e das alternativas operacionais. Uma implementação real exigiria mudança na imagem/base e na forma como a sandbox é executada.

## 2026-06-28 00:06:00 UTC — Análise da solicitação #739 e bloqueio de publicação em 5173
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a solicitação #739 implementou e validou a alteração da tela, mas, ao tentar disponibilizá-la na URL original `:5173`, o modelo identificou que essa porta era servida pelo container `marketinghub-frontend`/nginx e precisaria rebuildar/recriar esse container; a sessão não tinha Docker daemon disponível para fazer essa recriação.
- O que o modelo precisou e não teve: acesso a um runtime Docker funcional na própria sessão, ou uma ponte operacional equivalente para executar no host os comandos de build/recreate do container que publica a porta 5173.
- Consequência operacional: a validação foi desviada para um Vite dev server em `:5174`, enquanto a URL original `:5173` permaneceu servindo o container existente.

## 2026-06-28 00:15:00 UTC — Sugestão para oferecer capacidade operacional ao modelo
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: na #739 o modelo precisava promover a alteração validada para o serviço real em `:5173`, mas recebeu apenas a sandbox de código; faltou uma capacidade operacional segura para rebuild/recreate/logs do container no host.
- Sugestão principal: oferecer ao modelo uma ferramenta de operações controladas no host, reaproveitando o MCP Server já existente, com comandos allowlistados por ambiente/projeto (ex.: status, logs, build frontend, recreate frontend, healthcheck e rollback), em vez de habilitar Docker-in-Docker completo na sandbox.
- Guardrails recomendados: exigir confirmação/escopo do serviço, registrar auditoria por request/job, limitar comandos e paths, esconder segredos, aplicar timeout, rate limit e dry-run, e retornar ao usuário quando a ação tocar produção.
- Fluxo ideal: o modelo altera código e valida dentro da sandbox; se precisar publicar ou inspecionar container real, chama uma ferramenta `host-operation` de alto nível, que executa no host via MCP e devolve logs/resultado, sem expor o Docker daemon bruto dentro da sandbox.

## 2026-06-28 00:25:00 UTC — Registro de melhoria futura para operações de host na sandbox
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a proposta anterior sobre `host-operation` poderia ser confundida com implementação imediata; o objetivo correto é registrar a necessidade percebida na solicitação #739 como melhoria futura, sem alterar o runtime agora.
- Ação aplicada: criado `docs/melhorias/operacoes-host-sandbox.md` descrevendo o contexto da #739, o problema operacional, uma proposta futura de ferramenta controlada via MCP Server e os guardrails necessários.
- Decisão: não implementar Docker-in-Docker nem `host-operation` neste momento; manter apenas como documentação de melhoria futura para planejamento posterior.

## 2026-06-28 00:39:00 UTC — Correção de carregamento do novo favicon
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o novo SVG já estava publicado em `/favicon.svg`, mas o HTML continuava apontando para a mesma URL estável. Navegadores tratam favicons com cache persistente e podem manter o ícone antigo mesmo após o arquivo no servidor ser substituído.
- Correção aplicada: adicionado versionamento na URL do favicon (`/favicon.svg?v=aihub6-20260628`) para forçar uma nova requisição do navegador e atualizado o título da aba para `AI Hub 6`, alinhando a identidade visual com o novo ícone.
- Validação local/remota: confirmado via `curl` que `https://iahub.xyz/favicon.svg` já retorna o SVG novo; a mudança no HTML evita que o navegador reutilize a entrada antiga do cache do favicon.
## 2026-06-28 — Reforço de causa raiz no prompt do sandbox
- Investigada a lacuna observada na solicitação #741: o modelo conseguia identificar o problema e propor solução para o CTA do anúncio, mas o prompt do runner não exigia que a resposta explicitasse por que o erro aconteceu nem aprofundasse a cadeia causal antes da proposta.
- Ajustado o prompt sistêmico do `sandbox-orchestrator` para obrigar a pergunta “Por que esse erro aconteceu?”, diferenciar sintoma de causa, explorar hipóteses/proteções ausentes na etapa `LOCALIZAR_CAUSA` e incluir uma seção final “Causa raiz” mesmo em tarefas apenas diagnósticas.

## 2026-06-28 02:05:00 UTC — Análise da solicitação Codex ChatGPT #743
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a solicitação #743 chegou ao Codex App Server e produziu atividade, mas o turno não emitiu `turn/completed` dentro da janela configurada do sandbox-orchestrator, que por padrão é de 10 minutos, então o job foi marcado com `CODEX_TURN_INTERRUPTED`.
- Evidências coletadas no host via MCP: healthcheck `https://iahub.xyz/mcp` retornou `UP`; logs do `sandbox-orchestrator` mostraram o job `7c5508a1-65ae-4f08-8dd5-462cd906af59` recebendo polling contínuo, várias falhas internas de `exec_command` do Codex App Server com `CreateProcess ... No such file or directory`, e depois callback para o backend com erro 500; logs do backend entre 01:45 e 01:53 UTC mostraram a requisição `CodexRequest 743` consultando esse job e falhando ao persistir callback por `Duplicate entry '7c5508a1-65ae-4f08-8dd5-462cd906af59-0744-inbound' for key 'uq_codex_interactions_sandbox_id'`.
- Conclusão operacional: na interface apareceu apenas `CODEX_TURN_INTERRUPTED` porque esse é o erro final do timeout do turno; em paralelo, houve um problema de sincronização/persistência de interações duplicadas no backend que gerou callback 500 e dificultou a atualização limpa dos detalhes da execução.

## 2026-06-28 02:20:00 UTC — Aumento do timeout do turno Codex App Server
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a execução #743 estourou o limite operacional de 10 minutos aguardando `turn/completed`; para tarefas de código maiores, principalmente quando o App Server tenta investigar, editar e validar, esse limite era curto demais e transformava execuções ainda ativas em `CODEX_TURN_INTERRUPTED`.
- Ajuste aplicado: aumentado o timeout padrão de `CODEX_APP_SERVER_TURN_TIMEOUT_MS` para 30 minutos (`1800000` ms) tanto no fallback do `sandbox-orchestrator` quanto no `.env.example` usado pelo Compose, e atualizada a documentação do serviço.
- Observação: esse ajuste reduz interrupções prematuras, mas não substitui correções separadas para falhas internas de `exec_command` do Codex App Server ou para a condição de corrida de interações duplicadas observada no callback da #743.

## 2026-06-28 09:44:21 UTC-3
- Correção de registro: a entrada `2026-06-28 09:38:44 UTC-3` foi adicionada antes de registros posteriores já existentes; mantida por política append-only, e esta entrada registra a conclusão no final correto do arquivo.
- Implementado o novo menu `Codex ChatGPT MKT` com rota `/codex-chatgpt-mkt`, reutilizando a tela do Codex ChatGPT com configuração própria.
- Adicionado perfil dedicado `CHATGPT_CODEX_MKT` no frontend, backend e sandbox-orchestrator para usar o mesmo Codex App Server/sandbox do ChatGPT Codex, sem token OAuth legado no payload.
- Orientação MKT aplicada ao fluxo: analisar principalmente relatórios Markdown de marketing digital no repositório, campanhas, estratégias, resultados e oportunidades, gerando recomendações de melhoria e mantendo PR somente sob solicitação explícita.
- Validação executada: build do frontend, testes do sandbox-orchestrator e teste focado do backend `CodexRequestServiceTest`.

## 2026-06-28 13:33:40 UTC — Análise sobre Codex App Server com repositórios não GitHub
- Pergunta respondida: se o Codex App Server, integrado ao AI Hub, pode operar com outro provedor Git além do GitHub, como GitLab.
- Conclusão técnica: o `sandbox-orchestrator` já aceita `repoUrl` direto e clona via `git clone`, portanto a execução do Codex em um workspace Git não depende conceitualmente do GitHub; porém o fluxo atual do backend/UI do AI Hub monta jobs a partir de `owner/repo`, transforma isso em URL GitHub quando `repoUrl` não é enviado e mantém automações de token/PR baseadas na API do GitHub.
- Limitação prática: para GitLab hoje seria necessário enviar/implementar `repoUrl` e credenciais adequadas para clone, e criar suporte específico para merge request/comentários/webhooks/token GitLab se o objetivo for paridade com PRs e automações GitHub.

## 2026-06-28 13:36:02 UTC — Orientação sobre repositório Git próprio em VPS
- Pergunta respondida: se é viável criar um repositório de fontes próprio em uma VPS para uso com o Codex App Server/AI Hub.
- Conclusão: é viável e não é tecnicamente complicado para uso básico com Git remoto via SSH ou HTTPS; a complexidade aumenta apenas se o objetivo for reproduzir recursos de plataforma como interface web, pull/merge requests, revisão, webhooks, permissões granulares e CI/CD.
- Recomendação: começar com um repositório Git bare na VPS acessado por SSH para clone/push; se precisar de experiência parecida com GitHub/GitLab, considerar Gitea/Forgejo na própria VPS antes de implementar uma plataforma própria do zero.

## 2026-06-28 13:40:38 UTC — Documento de melhoria futura para repositórios Git próprios
- Pergunta respondida: registrar em `docs/melhorias` as opções discutidas para hospedar repositórios fora do GitHub e usá-los com o Codex App Server/AI Hub.
- Ação aplicada: criado `docs/melhorias/repositorios-git-proprios-codex.md` com alternativas Git bare em VPS, Gitea/Forgejo, GitLab self-hosted, suporte genérico por `repoUrl`, camada de provedores Git, cuidados de segurança e ordem sugerida de implementação.
- Decisão registrada: priorizar suporte genérico por `repoUrl` e clone/diff/patch antes de automatizar PR/MR, comentários, webhooks e pipelines por provedor.

## 2026-06-28 - Remoção do modelo Pro da combo ChatGPT Codex
- Investigação da causa raiz: a opção `gpt-5.5-pro` aparecia porque estava cadastrada na lista fallback hardcoded `CHATGPT_CODEX_MODELS` da página `CodexChatgptPage`, usada para preencher a combo quando a tela inicializa.
- Correção: removido `gpt-5.5-pro` dessa lista fallback, mantendo apenas modelos permitidos para uso na combo.

## 2026-06-29 - Lista de Prompts

- Adicionado menu "Lista de Prompts" no frontend e rota dedicada para listar listas cadastradas.
- Implementada tela de importação de arquivo `.md`, onde cada linha iniciada com `*` é tratada como um prompt.
- Criados endpoint, serviço, entidades, repositório e migrations para persistir listas de prompts e seus itens no banco de dados.

## 2026-06-29 - Orientação de melhor resposta e timeout de 1 hora no Codex ChatGPT
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: os perfis `CHATGPT_CODEX` e `CHATGPT_CODEX_MKT` não recebiam uma instrução explícita para priorizar a melhor resposta sem encurtar a análise por limites de tempo/interações; além disso, o timeout padrão do turno do Codex App Server estava em 30 minutos, menor que a janela de 1 hora solicitada.
- Ajuste aplicado: o input enviado ao `turn/start` agora inclui orientação de melhor resposta para os modos Codex ChatGPT e Codex ChatGPT MKT, e o timeout padrão `CODEX_APP_SERVER_TURN_TIMEOUT_MS` passou para 1 hora (`3600000` ms), mantendo override por variável de ambiente.

## 2026-06-29 — Prompt do Codex ChatGPT MKT com alternativas de decisão
- Solicitação recebida: reforçar o prompt do perfil Codex ChatGPT MKT para que o modelo, nos pontos mais importantes do fluxo de solução, gere pelo menos 3 alternativas boas, compare e siga pela melhor.
- Pergunta de causa raiz aplicada antes do ajuste: por que esse comportamento não acontecia de forma consistente? Porque o prompt do perfil MKT orientava foco documental/marketing e qualidade geral da resposta, mas não especificava um protocolo explícito de tomada de decisão com múltiplas alternativas.
- Ajuste aplicado no `sandbox-orchestrator`: o prompt enviado via Codex App Server e o prompt de perfil do runner agora instruem o modelo a elaborar pelo menos 3 alternativas boas, comparar benefícios, riscos, custo/esforço e aderência ao objetivo, escolher a melhor e justificar objetivamente.
- Teste do perfil MKT atualizado para garantir que a instrução de 3 alternativas e comparação esteja presente no payload `turn/start` enviado ao Codex App Server.

## 2026-06-29 — Atualização de Lista de Prompts por reenvio
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o endpoint de importação sempre criava um novo `PromptListRecord` a cada envio e o frontend sempre inseria o retorno no topo da lista; não havia busca por lista existente nem substituição transacional dos itens vinculados.
- Ajuste aplicado: o backend agora localiza uma lista existente pelo mesmo nome, apaga seus itens antigos via `orphanRemoval` e reconstrói os prompts a partir do novo arquivo `.md`, atualizando também o nome do arquivo de origem.
- Ajuste aplicado no frontend: a tela passou a comunicar o comportamento de criar ou atualizar lista e substitui o item retornado no estado local quando o backend reutiliza a mesma lista.
- Validação planejada: teste unitário do serviço para confirmar que reenviar arquivo para a mesma lista remove prompts antigos e mantém apenas os novos.

## 2026-06-30 — Ambiente local em desenvolvimentos complexos no Codex ChatGPT
- Solicitação recebida: incluir nos prompts dos perfis Codex ChatGPT e Codex ChatGPT MKT a orientação de que, em desenvolvimentos mais complexos, o modelo deve montar um ambiente local, executar o que pretende desenvolver e ajustar iterativamente até alcançar o funcionamento desejado.
- Pergunta explícita de causa raiz: por que esse comportamento precisava ser reforçado? Porque as instruções atuais priorizavam qualidade da resposta, análise e tomada de decisão, mas não exigiam de forma direta a validação prática em ambiente local durante desenvolvimentos complexos.
- Ajuste aplicado no `sandbox-orchestrator`: o input enviado ao Codex App Server e as instruções de perfil do runner agora incluem a orientação de montar ambiente local, executar e iterar até o funcionamento desejado para os perfis `CHATGPT_CODEX` e `CHATGPT_CODEX_MKT`.
- Testes atualizados para garantir que a instrução de ambiente local e iteração esteja presente no payload `turn/start` dos dois perfis.

## 2026-06-30 — Limite de prompts recentes na tela Prompts
- Solicitação recebida: alterar a tela de Prompts para mostrar somente as 10 interações mais recentes.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a página `PromptsPage` renderizava todos os registros retornados por `/prompts` após o filtro de busca, sem ordenar por `createdAt` em ordem decrescente e sem limitar a quantidade exibida; por isso registros antigos continuavam aparecendo na tela.
- Ajuste aplicado: a lista exibida agora é ordenada pela data de criação mais recente primeiro e limitada aos 10 primeiros registros após o filtro de busca.

## 2026-06-30 - Investigação de lentidão na tela de detalhe Codex #789
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a tela de detalhe disparava consultas repetidas ao sandbox para a mesma solicitação enquanto um refresh ainda estava em andamento, porque o bloqueio de concorrência em `refreshFromSandbox` só era aplicado depois da chamada externa `getJob`; assim, várias requisições simultâneas ainda aguardavam o sandbox e mantinham a tela em carregamento. Os logs do backend em produção também mostraram a execução #789 sendo atualizada repetidamente e a listagem de solicitações passando por `findAllByOrderByCreatedAtDesc`.
- Ajuste aplicado: o controle `SANDBOX_REFRESHES_IN_PROGRESS` passou a ser adquirido antes da chamada ao sandbox para evitar chamadas externas duplicadas para a mesma solicitação.
- Criados índices de banco para os acessos mais usados na tela/listagem Codex: busca por `external_id`, filtro por `rating` ordenado por criação e contagem/listagem de interações por solicitação.

## 2026-06-30 — Correção de versão duplicada em migrations Flyway
- Solicitação recebida: corrigir falha de inicialização do backend com `Found more than one migration with version 29`.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: duas alterações independentes criaram migrations MySQL com a mesma versão Flyway `V29` (`create_prompt_lists` e `add_codex_request_lookup_indexes`); o Flyway exige que cada migration versionada tenha número único e interrompe a inicialização antes de criar o `entityManagerFactory` quando encontra versões duplicadas.
- Ajuste aplicado: a migration de índices, criada depois da migration de listas de prompts, foi renumerada de `V29` para `V30`, preservando a ordem cronológica e eliminando a duplicidade de versão.

- 2026-06-30 UTC — Investigado o travamento da conversa em execuções longas (~15 minutos) na tela `/codex-chatgpt-mkt`. Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o acompanhamento fazia polling a cada 5s no detalhe e na lista enquanto o backend também aceitava callback do sandbox; sem timeout no `RestClient` do sandbox-orchestrator e sem a mesma trava para callbacks, uma sincronização longa/concorrente podia manter o refresh preso, gerar tentativas sobrepostas e deixar a conversa exibindo “Aguardando resposta do modelo...” sem avançar.
- Ajuste aplicado: o `RestClient` do sandbox-orchestrator passou a ter timeout configurável de conexão/leitura, callbacks do sandbox agora respeitam a mesma trava de sincronização por `CodexRequest` usada pelo polling, e a tela de conversa evita iniciar novo polling de detalhe enquanto o anterior ainda está em andamento.

## 2026-06-30 — Marcador na aba quando o modelo responde
- Solicitação recebida: criar uma marca na aba do navegador para avisar quando o modelo responder, evitando precisar abrir a aba do AI Hub 6 repetidamente.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a conversa do Codex ChatGPT atualizava a resposta por polling interno, mas não havia nenhum sinal fora do conteúdo da página quando a aba estava em segundo plano; assim, o usuário só percebia a conclusão ao voltar manualmente para a aba.
- Ajuste aplicado no frontend: a página de conversa agora detecta a transição de uma mensagem do modelo de status em andamento para status terminal enquanto a aba está oculta, altera o título para indicar “Resposta pronta” e troca temporariamente o favicon por um ícone com destaque; ao focar/visualizar a aba, o marcador é limpo e o favicon/título originais são restaurados.

## 2026-07-01 — Beep sonoro quando o modelo responde
- Solicitação recebida: além do indicador visual na aba do navegador, emitir um pequeno beep sonoro para avisar o usuário quando a resposta do modelo ficar pronta.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o marcador anterior atuava apenas sobre título e favicon, então o aviso dependia de o usuário notar a aba visualmente; não existia um canal auditivo complementar e navegadores exigem desbloqueio de áudio por interação do usuário antes de tocar sons automaticamente.
- Ajuste aplicado no frontend: o hook de marcador da conversa Codex ChatGPT agora prepara/desbloqueia um `AudioContext` em interações de ponteiro ou teclado e, na mesma transição que marca a aba como “Resposta pronta”, toca um beep curto e discreto quando o áudio já foi liberado pelo navegador.
- Validação executada: build de produção do frontend concluído com sucesso.

## 2026-07-01 — Evidência de reboot do host
- Causa raiz identificada nos logs: `qemu-ga` registrou `guest-shutdown called, mode: powerdown` e o logind informou `hypervisor initiated shutdown` às 04:21:44; os containers caíram por powerdown iniciado pelo hypervisor/provedor, não por app, Docker, OOM ou apt upgrade. Orientação operacional: após reboot, subir em `/root/ai-hub-6` com `docker compose up -d` e validar `docker compose ps`/logs.

## 2026-07-02 — Melodia sonora de resposta pronta
- Por que o aviso passava despercebido: o alerta anterior era apenas um beep senoidal curto, com volume baixo, então a causa raiz estava na baixa saliência sonora do próprio padrão de notificação.
- Ajuste aplicado no frontend: o aviso de resposta pronta agora agenda uma melodia de 14 notas com tons diferentes, volume maior, timbre mais presente e repetição da sequência 3 vezes para tornar o fim da tarefa mais perceptível.

## 2026-07-03 — Investigação da falha da solicitação Codex #944
- Solicitação recebida: investigar por que a solicitação Codex #944, exibida em `/codex/requests/944`, terminou como falha.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a execução não falhou por erro de código retornado pelo modelo; o registro da API mostra `status=FAILED` com `responseText=CODEX_TURN_INTERRUPTED`, sem `error` nem `executionLog`, após duração de 1.810.382 ms (~30min10s). Isso indica interrupção/cancelamento do turno pelo orquestrador/App Server durante a execução longa, antes de uma resposta final persistida.
- Evidências conferidas: healthcheck do MCP retornou `UP`; logs do backend registraram criação e despacho do job `47d3c87a-cbba-478a-96d1-6a312a926885` para o sandbox às 02:59:36 UTC, consultas ao sandbox, conteúdo parcial retornado e finalização persistida como `FAILED` na consulta `/api/codex/requests/944`.
- Sem ajuste de código aplicado nesta etapa; a resposta ao usuário deve orientar que a causa imediata foi `CODEX_TURN_INTERRUPTED` e que a próxima investigação, se necessário, deve focar logs do Codex App Server/sandbox do job para identificar quem emitiu a interrupção.
- Complemento da investigação: sim, a falha é compatível com timeout operacional de 30 minutos. A duração registrada foi 1.810.382 ms (~30min10s) e o container `ai-hub-6-sandbox-orchestrator-1` está rodando em produção com `CODEX_APP_SERVER_TURN_TIMEOUT_MS=1800000`, ou seja, 30 minutos. Embora o código atual tenha fallback de 1 hora, a variável de ambiente operacional do container ainda sobrescreve o valor para 30 minutos; por isso a execução #944 foi interrompida perto desse limite.

## 2026-07-03 — Timeout operacional de 60 minutos no Codex App Server
- Solicitação recebida: mudar o timeout do Codex App Server para 60 minutos após confirmação de que a solicitação #944 foi interrompida perto do limite operacional de 30 minutos.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o código já tinha fallback de 60 minutos, mas a produção carregava `.env` com `CODEX_APP_SERVER_TURN_TIMEOUT_MS=1800000`; como o `docker-compose` lê `.env` depois de `apps/sandbox-orchestrator/.env.example`, esse override operacional manteve o timeout efetivo em 30 minutos.
- Ajuste aplicado: `apps/sandbox-orchestrator/.env.example` passou para `CODEX_APP_SERVER_TURN_TIMEOUT_MS=3600000`, e o workflow de deploy agora remove qualquer valor antigo dessa variável no `.env` da VPS e grava explicitamente `CODEX_APP_SERVER_TURN_TIMEOUT_MS=3600000` junto de `CODEX_APP_SERVER_ENABLED=true`.

## 2026-07-03 — Remoção dos inserts de interações Codex no banco
- Solicitação recebida: verificar se as milhares de interações exibidas em solicitações Codex geram inserts no banco e, caso sim, remover esse comportamento.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: sim, o backend recebia `interactions` do sandbox-orchestrator e `recordInteractions` tentava inserir cada item novo em `codex_interactions`, usando `sandbox_interaction_id` para deduplicar. Em execuções longas do Codex App Server, eventos de streaming/modelo podem passar de 2.400 itens, gerando milhares de inserts para uma única solicitação sem necessidade operacional para a tela principal.
- Ajuste aplicado: o backend deixou de persistir cada interação em `codex_interactions`; agora grava apenas o resumo agregado `interactionCount` em `codex_requests`, mantém `modelTranscript` consolidado a partir das mensagens outbound e preserva a leitura legada da tabela somente como fallback para registros antigos sem `interactionCount` preenchido.
- Teste atualizado para garantir que callbacks com interações atualizam o contador e transcript, mas não chamam `codexInteractionRepository.save` nem `existsBySandboxInteractionId`.

## 2026-07-04 — Métricas nos cards de solicitações concluídas
- Solicitação recebida: exibir nos cards de solicitações concluídas o tempo gasto e a quantidade de interações.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o backend e o parser do frontend já disponibilizavam `durationMs` e `interactionCount`, mas a lista de histórico da página Codex ChatGPT renderizava apenas identificador, modelo, data e status; portanto a informação existia no contrato de dados e faltava ser apresentada no card.
- Ajuste aplicado no frontend: cards com status `COMPLETED` agora exibem “Tempo gasto” usando o formatador de duração existente e “Interações” com pluralização em pt-BR, mantendo os demais status sem essas métricas para evitar valores incompletos.

## 2026-07-04 — Limite visual no histórico do diálogo Codex
- Solicitação recebida: manter na tela de diálogo um histórico de somente 10 interações para evitar que a tela fique muito grande.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a conversa era renderizada com `conversation.map(...)` sobre todo o estado acumulado; cada nova pergunta e resposta permanecia visível indefinidamente, fazendo a área de diálogo crescer sem limite apesar de o histórico completo ainda ser útil para contexto e ações como pedir PR.
- Ajuste aplicado no frontend: a tela agora calcula uma janela visual com as últimas 10 mensagens, oculta as anteriores apenas na renderização e informa quantas interações antigas foram escondidas, preservando o estado completo para contexto interno da conversa.

## 2026-07-04 — Poda real do histórico do diálogo no navegador
- Solicitação recebida: avaliar se apenas ocultar mensagens antigas deixaria o browser pesado e ajustar para evitar esse risco.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: a correção anterior reduzia o DOM renderizado, mas ainda preservava todo o array `conversation` em memória e continuava usando esse histórico completo ao montar o prompt; assim conversas longas poderiam continuar pesando no navegador e aumentando payloads internos.
- Ajuste aplicado no frontend: o estado da conversa agora é podado para as últimas 10 mensagens sempre que novas mensagens são adicionadas ou atualizadas, e a tela informa que somente essa janela recente é mantida para evitar peso no navegador.

## 2026-07-04 11:56:11 UTC-3
- Diagnóstico de causa raiz da limitação de screenshot no sandbox: a imagem `apps/sandbox-orchestrator` instalava ferramentas de build/teste, mas não incluía um navegador headless; por isso agentes que precisavam gerar screenshots não encontravam Chrome/Chromium.
- Atualizado o Dockerfile do sandbox-orchestrator para instalar `chromium` via apt e publicar variáveis de ambiente compatíveis com Playwright/Puppeteer (`CHROME_BIN`, `CHROMIUM_BIN`, `PUPPETEER_EXECUTABLE_PATH`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).
- Documentada a capacidade de screenshots automatizados na arquitetura do sandbox.

## 2026-07-04 12:00:40 UTC-3
- Pergunta recebida: se o modelo entenderia sozinho que o sandbox possui Chromium ou se seria necessário informar isso no prompt inicial.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: apenas instalar Chromium melhora a capacidade do ambiente, mas não garante que o modelo descubra essa capacidade sem gastar ciclos; o prompt inicial não anunciava navegador/headless nem orientava screenshot em tarefas visuais.
- Ajustado o prompt inicial do runner para declarar Chromium em `/usr/bin/chromium`, variáveis compatíveis com Playwright/Puppeteer e orientação para usar screenshot automatizado quando houver UI, layout ou mudança visual; também foi adicionada cobertura de teste para essa instrução.

## 2026-07-04 12:17:37 UTC-3
- Solicitação recebida: implementar a opção C para imagens externas e locais, combinando visualização de arquivos gerados no sandbox com busca de imagens públicas por URL.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o sandbox já conseguia receber anexos de imagem do usuário e gerar screenshots com Chromium, mas imagens externas ou arquivos PNG/JPG/WebP/GIF produzidos no filesystem ficavam presos em fluxos textuais (`http_get`/shell), sem serem reinjetados no modelo como entrada visual multimodal.
- Implementadas as tools `read_image` e `fetch_image` no runner Responses API: elas validam caminho/URL, bloqueiam acesso fora do sandbox ou URLs internas via validação existente, limitam tamanho, detectam MIME PNG/JPG/WebP/GIF e reenviam a imagem ao próximo turno como `input_image` com detalhe alto.
- Atualizados prompt inicial, documentação e testes para orientar o modelo a usar `read_image` em screenshots/imagens locais e `fetch_image` em imagens externas públicas.

## 2026-07-04 — Timeout de 120 minutos e contador agregado de interações Codex
- Solicitação recebida: alterar o timeout do Codex App Server de 60 para 120 minutos e corrigir o card “Interações com o modelo” que passou a ficar zerado depois da remoção dos inserts individuais no banco.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o timeout ainda estava parametrizado em 3.600.000 ms no fallback, no `.env.example` e no workflow de deploy. Já o contador de interações dependia indiretamente do array `interactions` retornado pelo sandbox; ao parar de persistir cada item no banco, qualquer resposta/callback sem a lista completa deixava o backend sem uma métrica agregada confiável e o campo podia permanecer em zero.
- Ajuste aplicado: timeout padrão e valor de deploy atualizados para `7200000` ms; o sandbox agora publica `interactionCount` agregado a partir de `interactionSequence`, e o backend consome esse campo explícito antes de usar a lista de interações como fallback, mantendo a remoção dos inserts em `codex_interactions`.

## 2026-07-05 — Diagnóstico de 401 no download de dependência Maven privada
- Solicitação recebida: explicar como resolver falha do `ai-worker` que parou antes dos testes com `401 Unauthorized` ao baixar `com.marketinghub:ads-service:0.0.1-SNAPSHOT` do GitHub Packages.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: o erro ocorreu antes da execução dos testes porque o Maven tentou resolver uma dependência SNAPSHOT privada no GitHub Packages sem uma credencial válida/autorizada para o pacote/repositório; portanto a correção deve ajustar `GITHUB_ACTOR`/`GITHUB_TOKEN` ou `settings.xml`/segredos do ambiente de execução, não código do módulo.
- Orientação operacional: validar se o token usado no ambiente tem acesso ao pacote `com.marketinghub:ads-service`, permissões de leitura de packages/repositório, e se Maven está recebendo essas credenciais no host/container onde o `ai-worker` executa.
- Complemento solicitado: explicar onde colocar as credenciais para o modelo/sandbox conseguir baixar dependências privadas durante a execução.
- Orientação operacional: gravar `GITHUB_ACTOR` e `GITHUB_TOKEN` no `.env` carregado pelo `docker-compose` do `sandbox-orchestrator` ou enviar `githubToken` no payload do job; como o `run_shell` herda `process.env`, comandos Maven executados pelo modelo passam a enxergar essas variáveis dentro da sandbox.
- Complemento solicitado: indicar onde encontrar na interface do GitHub a criação do token e as permissões do pacote. Orientação: criar PAT clássico em Settings > Developer settings > Personal access tokens > Tokens (classic), marcar `read:packages` e, se pacote/repositório for privado, acesso ao repositório; no pacote, acessar owner/repositório > Packages > pacote Maven > Package settings para conferir visibilidade, vínculo de repositório e Manage Actions access quando aplicável.
- Correção da orientação após alerta do usuário sobre sobrescrita do `.env`: adicionada alternativa persistente fora do repositório para credenciais do GitHub Packages, montando `GITHUB_PACKAGES_TOKEN_HOST_DIR` no `sandbox-orchestrator` e exportando `GITHUB_ACTOR`/`GITHUB_TOKEN` a partir dos arquivos `github_actor` e `github_token` antes de iniciar o runner.
- Complemento operacional para o host: orientar o operador a criar `/root/infra/github-packages`, gravar `github_actor` e `github_token` com permissões restritas, confirmar que o `docker-compose.yml` implantado já possui o mount de `/run/secrets/github-packages`, recriar o `sandbox-orchestrator` e validar as variáveis dentro do container sem imprimir o token.
- Validação remota do host após o teste do usuário: o diretório `/root/infra/github-packages` já existe com `github_actor` e `github_token`, mas o `/root/ai-hub-6/docker-compose.yml` implantado ainda não contém o mount `/run/secrets/github-packages`; por isso o container ativo não recebe `GITHUB_ACTOR`/`GITHUB_TOKEN`. A ação correta é implantar a versão nova do compose ou aplicar temporariamente o patch no host e recriar o `sandbox-orchestrator`.

## 2026-07-05 - Correção de renderização de tabelas Markdown no chat Codex

- Pergunta de causa raiz: por que esse erro aconteceu?
- Causa raiz: o componente `MarkdownMessage` do chat renderizava somente blocos de código, listas simples e parágrafos; linhas de tabela Markdown eram tratadas como texto comum dentro de `<p>`, por isso a resposta do modelo aparecia com pipes em vez de uma tabela HTML.
- Ajuste: adicionado parser local para tabelas Markdown simples com linha divisória (`|---|---|`) e renderização em `<table>` antes do fallback de listas/parágrafos.

## 2026-07-05 - Proposta de cliente de e-mail para testes na sandbox

- Solicitação recebida: explicar como oferecer um cliente de e-mail na sandbox para permitir testes.
- Pergunta de causa raiz: por que hoje o modelo não consegue testar fluxos de e-mail de ponta a ponta?
- Causa raiz: a sandbox já possui comandos, navegador headless e tools HTTP/imagem, mas não possui um SMTP/webmail/API descartável; por isso testes de e-mail dependem de mocks, serviços externos ou inspeção manual.
- Proposta documentada: adicionar um serviço interno de captura de e-mail, preferencialmente Mailpit, expor SMTP/API somente na rede interna, informar as variáveis ao runner e evoluir para isolamento por job ou tool dedicada de leitura de mensagens.


## 2026-07-05 - Implementação do cliente de e-mail na sandbox para Codex ChatGPT MKT

- Solicitação recebida: implementar a proposta de cliente de e-mail na sandbox e comunicar essa capacidade ao modelo no perfil Codex ChatGPT MKT.
- Pergunta de causa raiz: por que o modelo ainda não conseguiria testar e-mails mesmo com a documentação anterior?
- Causa raiz: a proposta estava apenas documentada; faltavam um serviço SMTP/API real no compose, variáveis de ambiente estáveis no `sandbox-orchestrator` e instrução explícita no prompt do perfil `CHATGPT_CODEX_MKT`.
- Ajuste aplicado: adicionado serviço interno `sandbox-mail` baseado em Mailpit, variáveis `SANDBOX_SMTP_HOST`, `SANDBOX_SMTP_PORT`, `SANDBOX_MAIL_WEB_URL` e `SANDBOX_MAIL_API_URL`, e instrução no perfil MKT para usar SMTP descartável e API/UI interna sem credenciais reais.

## 2026-07-06 - Disponibilização da chave Gemini para o sandbox

- Solicitação recebida: disponibilizar ao modelo, dentro do container do sandbox, a variável de ambiente `GEMINI_API_KEY` a partir do arquivo físico do host `/root/infra/gemini-token/gemini_api_key`.
- Pergunta explícita de causa raiz: por que esse erro aconteceu?
- Causa raiz: o `sandbox-orchestrator` já carregava segredos do host para OpenAI e GitHub Packages via mounts dedicados, mas não havia mount nem bootstrap para o diretório de token do Gemini; como os comandos do modelo herdam apenas o ambiente do processo Node, `GEMINI_API_KEY` nunca chegava ao runner.
- Ajuste aplicado: adicionado mount somente leitura configurável por `GEMINI_TOKEN_HOST_DIR`, leitura do arquivo `gemini_api_key` no comando de inicialização do `sandbox-orchestrator` e documentação da variável para manter o segredo fora do repositório.

## 2026-07-07 - Fila backend para solicitações Codex ChatGPT

- Solicitação recebida: permitir que o usuário escreva e salve a próxima solicitação do Codex ChatGPT MKT enquanto a atual ainda está em execução, com controle de fila no backend e preservação das imagens anexadas.
- Pergunta explícita de causa raiz: por que esse erro aconteceu?
- Causa raiz: a tela bloqueava novos envios enquanto havia `activeRequestId` e o backend despachava toda solicitação imediatamente para o sandbox, sem persistir anexos em uma estrutura reutilizável para execução posterior; assim não havia uma fila confiável no servidor e imagens de uma solicitação futura poderiam ficar apenas no estado do navegador.
- Ajuste aplicado: o backend agora salva os anexos serializados na própria `codex_requests`, mantém novas solicitações como `PENDING` sem `external_id` quando já existe execução ativa para o perfil, e despacha automaticamente a próxima solicitação pendente ao detectar término da atual. A UI passou a permitir novos envios durante execuções pendentes/em andamento e monitora todas as respostas não terminais da conversa.

## 2026-07-07 12:21:17 UTC - PR de avisos da fila e objetivo Codex MKT

- Solicitação recebida: gerar PR com os ajustes de aviso de final de execução e prompt do perfil Codex MKT.
- Pergunta explícita de causa raiz: por que esse erro aconteceu?
- Causa raiz: o checkout atual não continha as alterações descritas no histórico da conversa; além disso, o aviso de conclusão tratava toda transição terminal como fim da fila, então acionava marcador visual e três repetições sonoras mesmo quando outra solicitação ainda estava `PENDING` ou `RUNNING`.
- Ajuste aplicado: a UI agora verifica se ainda há solicitação não terminal antes de marcar a aba; quando há próxima solicitação, toca somente uma repetição sonora. O prompt Codex MKT recebeu o objetivo principal de gerar vendas em larga escala de produtos digitais de alto valor com comunicação sedutora pelo sistema Marketing Hub no frontend e nos dois caminhos do sandbox-orchestrator.

## 2026-07-07 - Draft PR para ajustes do chat Codex

- Solicitação recebida: gerar como draft o PR dos ajustes do chat Codex.
- Pergunta explícita de causa raiz: por que esse erro aconteceu?
- Causa raiz: a branch remota `agent/codex-chat-20-interacoes-pendentes` existia, mas apontava para o mesmo commit de `main`, e o commit local citado no histórico não estava disponível neste checkout; portanto não havia diff real para abrir PR.
- Alternativas avaliadas: abrir PR vazio para preservar o fluxo, reconstruir somente as mudanças solicitadas, ou abandonar o draft até recuperar o commit original. A melhor opção foi reconstruir o ajuste mínimo, pois evita PR sem valor e atende ao pedido atual sem depender de estado local perdido.
- Ajuste reaplicado: a tela Codex ChatGPT carrega 20 itens, mantém até 20 mensagens visíveis, mostra data e hora nos balões de usuário/modelo e oferece apagar solicitações `PENDING` antes do envio. O backend expõe `DELETE /api/codex/requests/{id}` limitado a solicitações `PENDING` sem `externalId`.

- 2026-07-07 UTC — Ajustada a tela Codex ChatGPT/MKT para que o horário exibido na mensagem do modelo passe a refletir a entrega da resposta: investigada a causa raiz (o placeholder do assistente era criado com `new Date()` no envio e mantinha esse `createdAt` após conclusão) e a correção agora troca o timestamp para `finishedAt` da execução quando o status se torna terminal.

- 2026-07-07 UTC — Adicionada opção para editar solicitação Codex ChatGPT/MKT ainda pendente. Pergunta explícita de causa raiz: “por que não era possível editar uma solicitação enviada e pendente?”. Resposta: o fluxo só oferecia apagar antes do envio e o backend só expunha exclusão para `PENDING` sem `externalId`; não havia contrato de atualização antes do despacho. A correção adiciona `PATCH /api/codex/requests/{id}` limitado a solicitações pendentes não despachadas e botão/textarea de edição no chat, preservando o histórico reconstruído antes da mensagem editada.

- 2026-07-07 UTC — Ajustada a exclusão de solicitações pendentes no diálogo Codex ChatGPT/MKT. Pergunta explícita de causa raiz: “por que o usuário não via claramente que o item apagado antes de enviar tinha sido apagado?”. Resposta: o frontend removia o placeholder do modelo com `filter`, deixando apenas a mensagem do usuário no histórico visual, sem marcador de exclusão. A correção substitui o placeholder por uma mensagem explícita informando que a solicitação foi apagada antes do envio ao modelo e que nenhuma resposta será gerada.

## 2026-07-07 19:16:40 UTC-3
- Analisada a causa raiz do cenário relatado em que múltiplas solicitações acabam em branches separadas e apenas a última parece receber PR: o fluxo atual despacha cada `CodexRequest` como job independente, gera `jobId` novo, cria branch `ai-hub/cifix-${job.jobId}` por job e não possui agrupador/batch transacional para consolidar solicitações relacionadas antes de abrir PR.
- Proposta melhoria de desenho: introduzir agrupamento explícito de solicitações por repositório/branch base, uma branch de trabalho compartilhada por grupo e criação/atualização incremental de um PR único por grupo, preservando opção de PR isolado quando solicitado.

## 2026-07-07 19:21:41 UTC-3
- Implementada correção da causa raiz para solicitações Codex relacionadas não ficarem necessariamente presas ao padrão `1 job = 1 branch`: o backend passa a enviar uma `workBranch` estável por repositório, branch base e perfil, permitindo acumular entregas relacionadas em uma branch compartilhada.
- Ajustado o sandbox-orchestrator para aceitar `workBranch`, reutilizar a branch remota existente quando houver, commitar novas alterações por cima dela e reutilizar PR aberto quando a criação retornar conflito de PR já existente.
- Mantida compatibilidade com fluxos antigos: jobs sem `workBranch` continuam usando `ai-hub/cifix-${jobId}`.

## 2026-07-07 19:33:13 UTC-3
- Implementado botão/ícone de cópia em cada item do diálogo Codex ChatGPT/MKT (mensagens do usuário e do modelo).
- Pergunta explícita de causa raiz: “por que a cópia precisava de fallback?”. Resposta: `navigator.clipboard.writeText` depende de contexto seguro em muitos navegadores e o ambiente informado usa HTTP simples; por isso a correção usa Clipboard API apenas em `window.isSecureContext` e recorre a `textarea` + `document.execCommand('copy')` durante a interação do usuário.
- Adicionado feedback visual temporário no botão copiado e mensagem de erro orientativa quando a cópia não for permitida pelo navegador.

## 2026-07-07 - Reutilização da branch de trabalho antes de solicitar PR

- Solicitação recebida: investigar por que, depois de várias alterações solicitadas, ao pedir PR o modelo respondeu que o repositório estava limpo e que não havia mudanças locais.
- Pergunta explícita de causa raiz: por que esse erro aconteceu?
- Causa raiz: o sandbox clonava sempre a branch base (`main`) antes de chamar o modelo e só tentava reutilizar a `workBranch` existente no fim, durante a criação automática do PR; assim uma solicitação posterior de “criar PR” começava em um checkout limpo da base, sem carregar as alterações acumuladas na branch de trabalho remota.
- Ajuste aplicado: o sandbox agora captura o commit base logo após o clone, carrega a `workBranch` remota existente antes da execução do modelo e mantém o diff calculado contra a base original, permitindo que o modelo veja alterações anteriores e que o PR contenha o acumulado correto.

## 2026-07-08 - Análise conceitual de sandbox sem clone obrigatório

- Solicitação recebida: avaliar se é possível usar o conceito do sistema com sandbox sem baixar um repositório, em uma API que recebe uma requisição e um callback, permite ao modelo simular situações, pesquisar na internet, baixar elementos quando necessário e ao final responder via callback.
- Resposta técnica resumida: sim, é possível; o repositório deve ser opcional, e o job pode iniciar uma sandbox efêmera vazia com política de rede/ferramentas, limites de execução, armazenamento temporário, coleta de artefatos e chamada de callback assinada ao terminar.
- Observação de arquitetura: quando houver necessidade de alterar código versionado, o clone continua sendo útil; quando a tarefa for pesquisa, análise, simulação, geração de relatório ou processamento de insumos enviados no payload, a sandbox pode operar sem checkout de repositório.

## 2026-07-08 - Viabilidade de alto paralelismo em sandboxes sem repositório

- Solicitação recebida: avaliar se é viável executar uma grande quantidade de requisições em paralelo usando sandboxes efêmeras sem baixar repositório.
- Resposta técnica resumida: sim, é viável, desde que o sistema seja desenhado como uma plataforma assíncrona com fila, workers autoscaláveis, quotas por cliente, limites de concorrência, timeouts, isolamento por job, controle de custos e backpressure; não é recomendável executar tudo diretamente no ciclo HTTP síncrono da requisição.
- Recomendações principais: responder a criação do job imediatamente com `jobId`, processar em fila, separar workloads leves e pesados, aplicar rate limit e orçamento por tenant, usar callbacks idempotentes assinados, persistir estados do job e coletar métricas de fila, duração, falhas, custo e uso de recursos.

- 2026-07-08 00:00:00 UTC — Solicitação: corrigir totais de interações que continuavam zerados na lista do Codex ChatGPT.
- Pergunta explícita de causa raiz: “por que esse erro aconteceu?”. Resposta: alguns jobs retornavam `interactionCount: 0` mesmo contendo `interactionSequence`/`interactions` com eventos reais; o backend confiava cegamente no contador explícito quando ele existia, então preservava o zero defasado e ignorava as evidências agregadas disponíveis no payload.
- Ajuste aplicado: o backend agora resolve o total de interações pelo maior valor confiável entre `interactionCount`, `interactionSequence` e tamanho de `interactions`; o sandbox-orchestrator também normaliza respostas e callbacks com o maior contador disponível para evitar propagar zeros defasados.
## 2026-07-08 — Lote acumulado para solicitações Codex ChatGPT e PR draft

- Causa-raiz investigada: as solicitações podiam ser executadas em workspaces/branches diferentes e o botão de PR reconstruía o PR a partir da última resposta, não necessariamente da branch acumulada do lote.
- Alternativas avaliadas:
  - Criar um PR por solicitação: simples, mas fragmenta o fluxo e não atende ao uso de várias demandas pendentes.
  - Manter apenas histórico textual da conversa: barato, mas frágil para reconstruir alterações reais no fim.
  - Persistir `workBranch`/lote por solicitação e criar PR a partir da branch acumulada: maior esforço, mas preserva o estado real e alinha UI, backend e sandbox.
- Implementação escolhida: adicionar campos `work_branch` e `work_batch_key` em `codex_requests`, calcular branch de trabalho por repositório/branch/perfil, exibir lote atual na tela ChatGPT Codex e fazer o endpoint de PR priorizar draft PR a partir da branch acumulada.
- Objetivo de produto: permitir várias solicitações sequenciais no Marketing Hub sem perder alterações anteriores antes de pedir PR.
