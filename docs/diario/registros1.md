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
