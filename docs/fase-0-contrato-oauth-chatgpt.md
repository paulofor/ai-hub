# Fase 0 — Contrato de conta OAuth (ChatGPT/OpenAI)

## Objetivo
Formalizar o contrato entre frontend e backend para autenticação OAuth server-side, incluindo:
- endpoints públicos;
- payloads e respostas por cenário;
- política de erro padronizada;
- modelo de dados persistido para sessão OAuth;
- variáveis de ambiente obrigatórias/opcionais;
- política de mascaramento de segredos em logs.

## Endpoints de conta

### 1) `POST /api/account/login/start`
Inicia o fluxo OAuth com proteção CSRF (`state`) e PKCE (`code_challenge`).

**Request body**
```json
{
  "accountHint": "user@example.com"
}
```

- `accountHint` (opcional): e-mail sugerido para UX.

**200 OK (redirect_required)**
```json
{
  "status": "redirect_required",
  "authUrl": "https://auth.openai.com/oauth/authorize?...",
  "state": "opaque-state-id",
  "expiresAt": "2026-05-18T22:10:30Z"
}
```

**Erros**
- `400 invalid_request`: body inválido.
- `503 oauth_provider_unavailable`: provedor indisponível.
- `500 internal_error`: erro não classificado.

---

### 2) `GET /api/account/login/callback`
Processa o retorno do provedor com `authorization_code`.

**Query params esperados (sucesso)**
- `code` (obrigatório)
- `state` (obrigatório)

**Comportamento**
1. Valida `state` pendente.
2. Troca `code` por tokens no token endpoint.
3. Persiste sessão OAuth.
4. Redireciona para rota configurada de sucesso no frontend.

**Redirecionamentos de erro (frontend)**
- `?login=invalid_state`
- `?login=missing_code`
- `?login=token_exchange_failed`
- `?login=internal_error`

**HTTP direto (APIs/mocks/testes)**
- `400 invalid_state`
- `400 missing_code`
- `502 token_exchange_failed`
- `500 internal_error`

---

### 3) `GET /api/account/read`
Retorna estado real da sessão/token da conta conectada.

**200 OK — conectado**
```json
{
  "connected": true,
  "status": "connected",
  "accountEmail": "user@example.com",
  "expiresAt": "2026-05-18T23:45:00Z",
  "scopes": ["openid", "profile", "offline_access"],
  "lastRefreshAt": "2026-05-18T20:10:00Z"
}
```

**200 OK — expirado**
```json
{
  "connected": false,
  "status": "expired",
  "accountEmail": "user@example.com",
  "expiresAt": "2026-05-18T18:00:00Z"
}
```

**200 OK — desconectado**
```json
{
  "connected": false,
  "status": "disconnected",
  "accountEmail": "",
  "expiresAt": ""
}
```

---

### 4) `POST /api/account/logout`
Revoga sessão local e remove vínculos de autenticação.

**200 OK**
```json
{
  "connected": false,
  "status": "disconnected"
}
```

## Política de erros (catálogo)
Todos os erros de domínio devem usar o formato:

```json
{
  "error": {
    "code": "invalid_state",
    "message": "State inválido ou expirado.",
    "retryable": false,
    "correlationId": "b5a5ac29-..."
  }
}
```

### Códigos padronizados
- `invalid_request`
- `invalid_state`
- `missing_code`
- `token_exchange_failed`
- `refresh_failed`
- `oauth_provider_unavailable`
- `internal_error`

## Modelo de dados — sessão OAuth persistida
Tabela lógica sugerida: `oauth_account_session`

Campos mínimos:
- `id` (UUID)
- `workspace_id` (ou equivalente no modelo atual)
- `user_id` (ou equivalente)
- `provider` (`openai_chatgpt`)
- `account_email`
- `access_token_ciphertext`
- `refresh_token_ciphertext`
- `id_token_ciphertext`
- `token_type`
- `scope`
- `expires_at`
- `last_refresh_at`
- `revoked_at`
- `created_at`
- `updated_at`

Índices mínimos:
- `(workspace_id, user_id, provider)` único quando ativo (`revoked_at is null`).
- `expires_at` para consulta operacional.

## Variáveis de ambiente

### Obrigatórias
- `HUB_ACCOUNT_OAUTH_ISSUER`
- `HUB_ACCOUNT_OAUTH_CLIENT_ID`
- `HUB_ACCOUNT_OAUTH_AUTHORIZE_URL`
- `HUB_ACCOUNT_OAUTH_TOKEN_URL`
- `HUB_ACCOUNT_LOGIN_CALLBACK_URL`
- `HUB_ACCOUNT_OAUTH_SCOPES`

### Opcionais
- `HUB_ACCOUNT_OAUTH_CLIENT_SECRET` (quando aplicável)
- `HUB_ACCOUNT_LOGIN_SUCCESS_REDIRECT` (default: `/codex-chatgpt`)
- `HUB_ACCOUNT_OAUTH_CONNECT_TIMEOUT_MS` (default sugerido: `5000`)
- `HUB_ACCOUNT_OAUTH_READ_TIMEOUT_MS` (default sugerido: `10000`)

## Política de logs e mascaramento de segredos

### Nunca logar em texto puro
- `access_token`
- `refresh_token`
- `id_token`
- `client_secret`
- headers `Authorization`

### Padrão de mascaramento
- Tokens: exibir no máximo prefixo de 6 chars + `...` + sufixo de 4 chars.
- E-mail: mascarar parte local (`u***@dominio.com`) quando nível de log > INFO.
- Query string de callback: remover/mascarar `code` antes de persistir logs.

### Observabilidade mínima
- Incluir `correlationId` em todo log de fluxo de login/callback/refresh.
- Registrar transições de estado (`disconnected -> connected`, `connected -> expired`).

## Critério de pronto da Fase 0
A Fase 0 é considerada concluída quando frontend e backend concordarem com este contrato e nenhum endpoint de conta depender de suposições implícitas fora deste documento.
