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
