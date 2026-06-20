# Diálogo com a OpenAI — CodexRequest 713

Data da investigação: 2026-06-20.

## Objetivo

Registrar em documento próprio o diálogo observado nos logs entre o AI Hub e a OpenAI para a requisição Codex 713, com dados sensíveis mantidos sanitizados conforme os próprios logs do backend.

## Pergunta de causa raiz

Antes de concluir o diagnóstico, a pergunta obrigatória foi: **por que esse erro aconteceu?**

Resposta: o device login com a OpenAI concluiu com sucesso, mas a execução Codex 713 falhou antes de chegar ao modelo porque o backend tentou renovar OAuth usando `client_id=paulofore` com `client_secret`, recebendo `401 invalid_client`; em seguida tentou gerar o token Codex via token exchange enviando `organization_id`, e a OpenAI rejeitou com `400 Unknown parameter: 'organization_id'`.

## Linha do tempo observada

### 1. Solicitação de device code

O backend iniciou o fluxo de autenticação device code chamando a OpenAI:

```text
operation=device_user_code
method=POST
url=https://auth.openai.com/api/accounts/deviceauth/usercode
payload={client_id=app_EMoamEEZ73f0CkXaXp7hrann}
```

A OpenAI respondeu com os campos do fluxo device auth, com identificadores sensíveis sanitizados:

```text
operation=device_user_code
response={device_auth_id=[redacted], user_code=[redacted], interval=5, expires_at=2026-06-20T19:58:29.893250+00:00}
```

### 2. Polling enquanto o usuário ainda não tinha autorizado

O backend consultou repetidamente o status do device auth:

```text
operation=device_authorization_poll
method=POST
url=https://auth.openai.com/api/accounts/deviceauth/token
payload={device_auth_id=[redacted], user_code=[redacted]}
```

Enquanto a autorização ainda estava pendente, a OpenAI respondeu:

```text
status=403
code=deviceauth_authorization_pending
message=Device authorization is pending. Please try again.
```

### 3. Polling concluído com sucesso

Depois da autorização, a OpenAI retornou sucesso no polling:

```text
operation=device_authorization_poll
response={status=success, user_code=[redacted], user_code_expiration=[redacted], authorization_code=[redacted], code_challenge=[redacted], code_verifier=[redacted]}
```

### 4. Troca do authorization code por tokens OAuth

Com o `authorization_code`, o backend chamou o endpoint OAuth:

```text
operation=authorization_code_exchange
method=POST
url=https://auth.openai.com/oauth/token
payload={code=[redacted], grant_type=authorization_code, redirect_uri=https://auth.openai.com/deviceauth/callback, client_id=app_EMoamEEZ73f0CkXaXp7hrann, code_verifier=[redacted]}
```

A OpenAI retornou tokens, todos sanitizados nos logs:

```text
operation=authorization_code_exchange
response={access_token=[redacted], token_type=[redacted], expires_in=864000, scope=openid profile email offline_access, id_token=[redacted], earliest_refresh_at=1782762279, refresh_token=[redacted], oai_is=...}
```

### 5. Criação e disparo da CodexRequest 713

Após a autenticação, o backend criou a solicitação Codex:

```text
Criando CodexRequest para ambiente paulofor/marketing-hub com modelo gpt-5.3-codex (perfil CHATGPT_CODEX)
CodexRequest 713 salvo, enviando para sandbox se aplicável
Enviando CodexRequest 713 para sandbox com jobId 7e54e7e0-1274-409c-981d-531026988a22 e branch padrão main
```

### 6. Falha no refresh OAuth

Antes de enviar ao sandbox com token válido, o backend tentou renovar o OAuth:

```text
operation=oauth_token_refresh
method=POST
url=https://auth.openai.com/oauth/token
payload={refresh_token=[redacted], grant_type=refresh_token, scope=openid profile email, client_secret=[redacted], client_id=paulofore}
```

A OpenAI rejeitou a chamada:

```text
status=401
code=invalid_client
message=Invalid client specified.
```

A tentativa ocorreu três vezes e terminou com o aviso:

```text
Falha ao renovar OAuth para obter claims de organização no id_token: 401 Unauthorized
```

### 7. Falha no token exchange Codex

Depois da falha no refresh, o backend tentou trocar o token para obter um token Codex/API:

```text
operation=codex_api_token_exchange
method=POST
url=https://auth.openai.com/oauth/token
payload={subject_token_type=[redacted], grant_type=urn:ietf:params:oauth:grant-type:token-exchange, requested_token=[redacted], organization_id=org-DgyTLAxNYnw0cOQVlAXInkyR, subject_token=[redacted], client_id=app_EMoamEEZ73f0CkXaXp7hrann}
```

A OpenAI rejeitou o parâmetro `organization_id`:

```text
status=400
code=unknown_parameter
param=organization_id
message=Unknown parameter: 'organization_id'.
```

O backend então registrou:

```text
Falha no token exchange Codex; execução seguirá sem token derivado para o sandbox
CodexRequest 713 será executado sem token OAuth válido de conta conectada
```

## Observação sobre a chamada ao modelo

Também foram consultados os logs do `sandbox-orchestrator`. Eles mostraram apenas a inicialização do serviço:

```text
Sandbox orchestrator listening on port 8083
```

Não apareceu log de `responses.create`, portanto não há evidência de conversa com a Responses API/modelo para a CodexRequest 713. O diálogo observado com a OpenAI ficou restrito ao fluxo de autenticação e token exchange.

## Conclusão

A autenticação inicial por device code funcionou. A falha da requisição 713 ocorreu depois, na preparação do token de execução do Codex:

1. `oauth_token_refresh` falhou com `invalid_client` porque foi enviado `client_id=paulofore` com `client_secret`.
2. `codex_api_token_exchange` falhou com `unknown_parameter` porque foi enviado `organization_id` no payload.
3. Sem token Codex derivado, o sandbox não chegou a chamar o modelo.
