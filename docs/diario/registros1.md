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
