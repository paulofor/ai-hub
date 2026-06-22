# Diálogo com a OpenAI — CodexRequest 718

Data da investigação: 2026-06-22.

## Objetivo

Registrar em documento próprio o diálogo observado nos logs entre o AI Hub e a OpenAI para a requisição Codex 718, mantendo dados sensíveis sanitizados conforme os logs do backend.

## Pergunta de causa raiz

Antes de concluir o diagnóstico, a pergunta obrigatória foi: **por que esse erro aconteceu?**

Resposta: a execução 718 repetiu a causa operacional das execuções 714 e 716: a sessão ativa foi criada pelo **device login público** (`client_id=app_EMoamEEZ73f0CkXaXp7hrann`). Esse fluxo autenticou e renovou tokens com sucesso, mas o `id_token` renovado continuou sem a claim `organization_id` exigida pelo token exchange Codex. Como o backend bloqueia o token exchange quando sabe que o `id_token` não tem a organização configurada, a requisição foi enviada ao sandbox sem token de execução Codex e não chegou à chamada do modelo.

A diferença em relação à 715 é que o erro `400 unknown_parameter` por `organization_id` no refresh não apareceu mais. O refresh da 718 foi aceito pela OpenAI, confirmando que a correção de não enviar `organization_id` no refresh funcionou. O problema restante é a origem da sessão: ela ainda veio do device login público, não do login browser/PKCE capaz de solicitar autorização do workspace com `id_token_add_organizations=true` e `allowed_workspace_id`.

## Linha do tempo observada

### 1. Solicitação de device code

O backend iniciou o fluxo device auth chamando a OpenAI:

```text
operation=device_user_code
method=POST
url=https://auth.openai.com/api/accounts/deviceauth/usercode
payload={client_id=app_EMoamEEZ73f0CkXaXp7hrann}
```

A OpenAI respondeu com os dados do device auth, todos com identificadores sensíveis sanitizados nos logs:

```text
operation=device_user_code
response={device_auth_id=[redacted], user_code=[redacted], interval=5, expires_at=2026-06-22T17:12:47.105853+00:00}
```

### 2. Polling enquanto a autorização estava pendente

O backend consultou repetidamente o status da autorização:

```text
operation=device_authorization_poll
method=POST
url=https://auth.openai.com/api/accounts/deviceauth/token
payload={device_auth_id=[redacted], user_code=[redacted]}
```

Enquanto o usuário ainda não havia concluído a autorização, a OpenAI retornou:

```text
status=403
code=deviceauth_authorization_pending
message=Device authorization is pending. Please try again.
```

### 3. Polling concluído

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

A OpenAI retornou tokens com sucesso:

```text
operation=authorization_code_exchange
response={access_token=[redacted], token_type=[redacted], expires_in=864000, scope=openid profile email offline_access, id_token=[redacted], earliest_refresh_at=1782925114, refresh_token=[redacted], oai_is=[redacted]}
```

### 5. Criação da CodexRequest 718

Após a autenticação, o backend criou a solicitação Codex:

```text
Criando CodexRequest para ambiente paulofor/marketing-hub com modelo gpt-5.3-codex (perfil CHATGPT_CODEX)
CodexRequest 718 salvo, enviando para sandbox se aplicável
Enviando CodexRequest 718 para sandbox com jobId 590ba76e-0750-4b59-91f9-bd7c6030cb7f e branch padrão main
```

### 6. Refresh OAuth aceito pela OpenAI

Antes de enviar ao sandbox, o backend renovou a sessão com o client público correto e sem parâmetros extras rejeitados:

```text
operation=oauth_token_refresh
method=POST
url=https://auth.openai.com/oauth/token
payload={refresh_token=[redacted], grant_type=refresh_token, scope=openid profile email, client_id=app_EMoamEEZ73f0CkXaXp7hrann}
```

A OpenAI aceitou o refresh e retornou tokens renovados:

```text
operation=oauth_token_refresh
response={access_token=[redacted], token_type=[redacted], expires_in=864000, scope=openid profile email offline_access, id_token=[redacted], earliest_refresh_at=1782925148, refresh_token=[redacted], oai_is=[redacted]}
```

### 7. Bloqueio antes do token exchange Codex

Após o refresh, o backend verificou o `id_token` renovado e não encontrou a organização configurada:

```text
Refresh OAuth concluído, mas id_token ainda não contém organization_id esperado para Codex; token exchange não será tentado para evitar invalid_subject_token. O device login público não retornou organization_id; refaça a conexão pelo login browser do ChatGPT/Codex para autorizar o workspace configurado.
```

Em seguida, a execução seguiu sem token derivado:

```text
CodexRequest 718 será executado sem token OAuth válido de conta conectada
```

## Comparação com as execuções anteriores

### Comparação com 713

Na 713 havia duas falhas distintas:

1. refresh usando `client_id=paulofore` com `client_secret`, resultando em `401 invalid_client`;
2. token exchange enviando `organization_id` no corpo, resultando em `400 unknown_parameter`.

Na 718 essas duas falhas não aparecem. O refresh usa `client_id=app_EMoamEEZ73f0CkXaXp7hrann`, não envia `client_secret` e não envia `organization_id`.

### Comparação com 714

A 718 reproduz o mesmo resultado funcional da 714: device login público e refresh bem-sucedidos, mas `id_token` sem `organization_id`. A diferença é que na 718 o backend já bloqueia o token exchange antes de receber `401 invalid_subject_token`, evitando uma chamada que a OpenAI já rejeitou anteriormente.

### Comparação com 715

Na 715 o refresh falhou porque `organization_id` voltou a ser enviado no corpo do refresh e a OpenAI respondeu `400 unknown_parameter`. Na 718 isso foi corrigido: o refresh foi aceito. Portanto a correção da 715 resolveu o erro de payload, mas não resolveu a ausência de organização no `id_token` de sessões device.

### Comparação com 716

A 716 e a 718 têm a mesma causa final: a sessão ativa ainda era device login público. O ajuste posterior à 716 fez a UI preferir login browser quando `oauthConfigured=true`, mas a investigação operacional da 718 indicou que a produção ainda tinha `HUB_ACCOUNT_OAUTH_CLIENT_ID=paulofore`, valor inválido que fazia o backend não expor OAuth browser como pronto e mantinha a UI no fallback device.


### Comparação com 717

A 718 repetiu praticamente a mesma linha do tempo da 717: nova sessão device pública, authorization-code exchange bem-sucedido, refresh aceito e `id_token` renovado sem `organization_id`. A persistência do comportamento indica que a nova tentativa ainda não usou uma sessão browser/PKCE com autorização explícita do workspace.

## Conclusão

A execução 718 não falhou por `invalid_client` nem por `organization_id` no refresh. Ela falhou porque a sessão usada para executar Codex ainda foi originada pelo device login público, que, nos logs observados das execuções 714, 716, 717 e 718, não retorna `organization_id` no `id_token`.

A solução definitiva para o caminho observado é impedir que a configuração inválida `HUB_ACCOUNT_OAUTH_CLIENT_ID=paulofore` force a UI a voltar para device login quando existe um client público válido (`HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann`). O login que precisa ser usado para novas tentativas é o browser/PKCE com solicitação explícita de workspace (`id_token_add_organizations=true` e `allowed_workspace_id=org-DgyTLAxNYnw0cOQVlAXInkyR`).
