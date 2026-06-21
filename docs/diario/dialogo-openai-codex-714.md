# Diálogo com a OpenAI — CodexRequest 714

Data da investigação: 2026-06-21.

## Objetivo

Registrar em documento próprio o diálogo observado nos logs entre o AI Hub e a OpenAI para a requisição Codex 714, com dados sensíveis mantidos sanitizados conforme os próprios logs do backend.

## Pergunta de causa raiz

Antes de concluir o diagnóstico, a pergunta obrigatória foi: **por que esse erro aconteceu?**

Resposta: a autenticação ChatGPT por device code e o refresh OAuth passaram a funcionar com o `client_id` público correto, porém o `id_token` retornado pela OpenAI continuou sem a claim `organization_id` esperada para o Codex. Por isso, quando o backend tentou o token exchange para derivar o token de execução (`openai-api-key`), a OpenAI rejeitou o `subject_token` com `401 invalid_subject_token` e a mensagem `Invalid ID token: missing organization_id`. Sem token derivado, a execução 714 foi enviada ao sandbox sem token OAuth válido e não chegou a chamar o modelo.

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
response={device_auth_id=[redacted], user_code=[redacted], interval=5, expires_at=2026-06-21T01:04:13.279444+00:00}
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
response={access_token=[redacted], token_type=[redacted], expires_in=864000, scope=openid profile email offline_access, id_token=[redacted], earliest_refresh_at=1782780605, refresh_token=[redacted], oai_is=...}
```

### 5. Criação e disparo da CodexRequest 714

Após a autenticação, o backend criou a solicitação Codex:

```text
Criando CodexRequest para ambiente paulofor/marketing-hub com modelo gpt-5.3-codex (perfil CHATGPT_CODEX)
CodexRequest 714 salvo, enviando para sandbox se aplicável
Enviando CodexRequest 714 para sandbox com jobId b0c2bb02-8270-475c-a706-41b3b8325d91 e branch padrão main
```

### 6. Refresh OAuth bem-sucedido

Antes de enviar ao sandbox, o backend renovou os tokens OAuth usando o client público correto e sem `client_secret`:

```text
operation=oauth_token_refresh
method=POST
url=https://auth.openai.com/oauth/token
payload={refresh_token=[redacted], grant_type=refresh_token, scope=openid profile email, client_id=app_EMoamEEZ73f0CkXaXp7hrann}
```

A OpenAI aceitou o refresh e retornou novos tokens:

```text
operation=oauth_token_refresh
response={access_token=[redacted], token_type=[redacted], expires_in=864000, scope=openid profile email offline_access, id_token=[redacted], earliest_refresh_at=1782780772, refresh_token=[redacted], oai_is=...}
```

Logo depois, o backend registrou que o refresh foi aceito, mas o `id_token` ainda não continha a organização esperada:

```text
Refresh OAuth concluído, mas id_token ainda não contém organization_id esperado para Codex
```

### 7. Falha no token exchange Codex

Em seguida, o backend tentou trocar o `id_token` por um token de execução Codex/API:

```text
operation=codex_api_token_exchange
method=POST
url=https://auth.openai.com/oauth/token
payload={subject_token_type=[redacted], grant_type=urn:ietf:params:oauth:grant-type:token-exchange, requested_token=[redacted], subject_token=[redacted], client_id=app_EMoamEEZ73f0CkXaXp7hrann}
```

A OpenAI rejeitou o `subject_token` porque o `id_token` não carregava `organization_id`:

```text
status=401
code=invalid_subject_token
message=Invalid ID token: missing organization_id
```

O backend então registrou:

```text
Falha no token exchange Codex; execução seguirá sem token derivado para o sandbox
CodexRequest 714 será executado sem token OAuth válido de conta conectada
```

## Observação sobre a chamada ao modelo

Também foram consultados os logs do `sandbox-orchestrator`. Eles mostraram apenas a inicialização do serviço:

```text
Sandbox orchestrator listening on port 8083
```

Não apareceu log de `responses.create`, portanto não há evidência de conversa com a Responses API/modelo para a CodexRequest 714. O diálogo observado com a OpenAI ficou restrito ao fluxo de autenticação, refresh OAuth e token exchange.

## Conclusão

A falha da requisição 714 é diferente da falha 713 em dois pontos importantes:

1. O refresh OAuth agora usou `client_id=app_EMoamEEZ73f0CkXaXp7hrann`, sem `client_secret`, e foi aceito pela OpenAI.
2. O token exchange Codex agora não enviou `organization_id` no corpo, então não houve mais `Unknown parameter: 'organization_id'`.

Mesmo assim, a execução continuou falhando porque o `id_token` emitido/renovado pela OpenAI ainda veio sem `organization_id`. A causa raiz atual é a ausência da claim de organização no `id_token` usado como `subject_token` do token exchange Codex, não mais um `invalid_client` no refresh nem um parâmetro extra no token exchange.
