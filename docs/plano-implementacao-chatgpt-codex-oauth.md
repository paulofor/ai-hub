# Plano de implementação — Conexão AI Hub “como ChatGPT” (padrão codex-rs)

## Objetivo
Implementar no AI Hub um fluxo de autenticação e uso de credenciais equivalente ao padrão do `codex-rs`, eliminando o modo simulado de sessão por e-mail e habilitando OAuth server-side completo com renovação automática de token.

## Escopo
- Backend (`apps/backend`) com OAuth robusto para conta ChatGPT/OpenAI.
- Frontend (`apps/frontend`) com UX de conexão, reconexão e observabilidade do estado real da sessão.
- Persistência segura de tokens e uso efetivo do `access_token` em execuções do Codex.

## Critérios de sucesso
1. Login inicia em URL OAuth real com `state` + PKCE e callback válido.
2. Callback processa `authorization_code`, troca por `access_token`/`refresh_token`/`id_token` e persiste com segurança.
3. Endpoint `/api/account/read` reflete estado real da sessão/token (ativo, expirado, desconectado).
4. Execuções Codex usam token válido e realizam refresh automático quando necessário.
5. Telemetria e logs permitem diagnosticar falhas de autenticação sem depender de inspeção manual de sessão.

---

## Fase 0 — Preparação e alinhamento de contrato

### Entregas
- Definir contrato dos endpoints de conta:
  - `POST /api/account/login/start`
  - `GET /api/account/login/callback`
  - `GET /api/account/read`
  - `POST /api/account/logout`
- Definir modelo de dados para sessão OAuth persistida (expiração, rotação, metadados mínimos).
- Definir variáveis de ambiente obrigatórias e opcionais.

### Tarefas técnicas
- Documentar payloads/respostas e códigos HTTP esperados por cenário.
- Definir política de erro (ex.: `invalid_state`, `token_exchange_failed`, `refresh_failed`).
- Definir padrão de mascaramento de segredos em logs.

### Riscos
- Ambiguidade de contrato entre frontend e backend gerar regressão de UX.

---

## Fase 1 — Login OAuth real com PKCE + state

### Entregas
- `login/start` gera `state`, `code_verifier`, `code_challenge` e URL de autorização real.
- `login/callback` valida `state` e rejeita requisição inválida.

### Tarefas técnicas (backend)
- Criar utilitário PKCE (S256) e anti-CSRF `state`.
- Persistir `state`/`code_verifier` temporários associados à sessão/login em andamento.
- Montar URL authorize com parâmetros corretos (`client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method`).

### Tarefas técnicas (frontend)
- Ajustar fluxo “Conectar com ChatGPT” para abrir somente `authUrl` retornada pelo backend.
- Exibir status intermediário “aguardando retorno do provedor”.

### Critérios de aceite
- Callback sem `state` válido deve falhar com mensagem explícita e sem conectar sessão.

---

## Fase 2 — Exchange de código por tokens + persistência segura

### Entregas
- Callback troca `authorization_code` por tokens no endpoint OAuth oficial.
- Tokens passam a ser persistidos com segurança no backend (não em query params).

### Tarefas técnicas (backend)
- Implementar client HTTP para token endpoint (`grant_type=authorization_code`).
- Tratar resposta e armazenar:
  - `access_token`
  - `refresh_token`
  - `id_token`
  - `expires_in` / `expires_at`
- Criptografar campos sensíveis em repouso (ou abstração equivalente segura).
- Remover aceitação de tokens via query string no callback.

### Tarefas técnicas (dados)
- Criar migration para armazenamento de sessão OAuth por conta/projeto/usuário (conforme modelo atual do AI Hub).
- Incluir campos de auditoria (`created_at`, `updated_at`, `last_refresh_at`, `revoked_at`).

### Critérios de aceite
- Após login bem-sucedido, `/api/account/read` retorna conta conectada com expiração real.

---

## Fase 3 — Refresh automático e robustez operacional

### Entregas
- Renovação automática de `access_token` usando `refresh_token` antes de expirar.
- Política de retry/backoff para erros transitórios de OAuth.

### Tarefas técnicas
- Implementar serviço de `TokenLifecycleManager` no backend.
- Aplicar refresh sob demanda:
  - ao consultar estado da conta;
  - antes de disparar execução Codex.
- Tratar falhas de refresh com transição de estado para `expired` + instrução de reconexão.

### Critérios de aceite
- Execução não deve falhar por token expirado quando houver `refresh_token` válido.

---

## Fase 4 — Integração com execução Codex e observabilidade

### Entregas
- Serviço que dispara jobs usa `access_token` válido como bearer de forma determinística.
- Métricas/logs de autenticação e refresh disponíveis para troubleshooting.

### Tarefas técnicas
- Propagar token já renovado para o cliente executor/sandbox.
- Adicionar métricas:
  - `oauth_login_start_total`
  - `oauth_login_success_total`
  - `oauth_token_refresh_total`
  - `oauth_token_refresh_failure_total`
- Log estruturado com correlation id por fluxo de login.

### Critérios de aceite
- Diagnóstico de falhas possível por logs/métricas sem inspeção manual de sessão.

---

## Fase 5 — Segurança, testes e rollout

### Entregas
- Suite de testes automatizados cobrindo fluxos críticos.
- Rollout gradual com feature flag e plano de rollback.

### Tarefas técnicas
- Testes backend:
  - unitários para PKCE/state;
  - integração para exchange/refresh;
  - cenários de erro e expiração.
- Testes frontend:
  - conexão/desconexão;
  - estado expirado;
  - mensagens de erro e telemetria.
- Rollout:
  - habilitar por ambiente;
  - monitorar métricas por 24–72h;
  - ampliar gradualmente.

### Critérios de aceite
- Taxa de sucesso de login e refresh estável no ambiente alvo.
- Sem regressão nos fluxos existentes de execução.

---

## Dependências e configurações
- Credenciais OAuth válidas (client id/secret quando aplicável).
- Callback URL pública e estável por ambiente.
- Estratégia de criptografia/gestão de segredo aprovada para tokens.

## Variáveis sugeridas
- `HUB_ACCOUNT_OAUTH_ISSUER`
- `HUB_ACCOUNT_OAUTH_CLIENT_ID`
- `HUB_ACCOUNT_OAUTH_CLIENT_SECRET` (se aplicável)
- `HUB_ACCOUNT_OAUTH_AUTHORIZE_URL`
- `HUB_ACCOUNT_OAUTH_TOKEN_URL`
- `HUB_ACCOUNT_LOGIN_CALLBACK_URL`
- `HUB_ACCOUNT_OAUTH_SCOPES`

## Não-objetivos (neste ciclo)
- Suporte multi-provedor genérico além do fluxo ChatGPT/OpenAI.
- Reestruturação completa de autorização de toda a plataforma.

## Resultado esperado
Ao final, o AI Hub deixará de operar em “sessão simulada” e passará a seguir o mesmo princípio do `codex-rs`: autenticação OAuth real, token lifecycle gerenciado e execução com credenciais válidas de ponta a ponta.
