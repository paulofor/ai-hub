# Correção necessária — OAuth do Codex e `client_id`

## Contexto

A análise da `CodexRequest 713`, registrada em `docs/diario/dialogo-openai-codex-713.md`, mostrou que o login por device code foi concluído corretamente, mas a preparação do token de execução falhou antes de qualquer chamada à Responses API.

O problema não está no modelo nem no sandbox. Ele está na mistura de dois clientes OAuth diferentes e no envio de um parâmetro inválido ao endpoint `/oauth/token`.

## Diagnóstico confirmado

### Client público correto do Codex

O fluxo device code foi iniciado e concluído com:

```text
app_EMoamEEZ73f0CkXaXp7hrann
```

Esse é o client público usado no fluxo Codex presente em `exemplos/codex-rs`. Ele foi aceito pela OpenAI nas etapas:

1. solicitação do device code;
2. polling da autorização;
3. troca do authorization code por `access_token`, `refresh_token` e `id_token`.

Portanto, o `refresh_token` criado nessa autenticação pertence a esse mesmo client público.

### Client incorreto usado no refresh

Na renovação da sessão, o backend enviou:

```text
client_id=paulofore
client_secret=[redacted]
```

A OpenAI respondeu:

```text
401 invalid_client
Invalid client specified.
```

O valor `paulofore` não é um `client_id` OAuth válido para esse fluxo e não deve ser utilizado. Um `client_id` OAuth da OpenAI usado neste projeto tem formato `app_...`.

Além disso, o client público do device login não usa `client_secret`.

### Parâmetro inválido no token exchange

Depois da falha no refresh, o backend tentou gerar o token de execução Codex enviando `organization_id` no corpo do token exchange:

```text
organization_id=org-DgyTLAxNYnw0cOQVlAXInkyR
```

A OpenAI respondeu:

```text
400 unknown_parameter
Unknown parameter: 'organization_id'.
```

O `organization_id` não deve ser enviado no corpo do refresh nem no corpo do token exchange de `/oauth/token`.

## Causa raiz no desenho atual

O backend persiste na sessão:

- `access_token`;
- `refresh_token`;
- `id_token`;
- expiração e e-mail.

Entretanto, ele não persiste qual client OAuth originou esses tokens.

Ao renovar a sessão, `TokenLifecycleManager.resolveClientIdForTokenRefresh()` prefere globalmente `HUB_ACCOUNT_OAUTH_CLIENT_ID`. Isso permite que uma sessão criada pelo device client público seja renovada com outro client configurado no servidor.

Também existe uma segunda falha: `buildCodexApiTokenExchangePayload()` volta a adicionar `organization_id`, mesmo após a OpenAI já ter rejeitado esse campo como parâmetro desconhecido.

## Correção de código necessária

### 1. Persistir o client que criou a sessão

Adicionar atributos próprios de sessão, por exemplo:

```text
chatgpt_oauth_client_id
chatgpt_oauth_client_type
```

Valores para device login:

```text
chatgpt_oauth_client_id=app_EMoamEEZ73f0CkXaXp7hrann
chatgpt_oauth_client_type=public
```

Valores para login browser com aplicativo OAuth próprio:

```text
chatgpt_oauth_client_id=<client app_... realmente configurado>
chatgpt_oauth_client_type=confidential
```

Esses dados devem ser gravados junto com os tokens, imediatamente após o authorization-code exchange bem-sucedido.

### 2. Renovar usando o mesmo client da sessão

O refresh deve usar o client salvo na sessão, não escolher um client global diferente.

Para uma sessão device/Codex, o payload esperado é:

```json
{
  "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
  "grant_type": "refresh_token",
  "refresh_token": "[redacted]"
}
```

O escopo `openid profile email` pode ser mantido somente se continuar compatível com o contrato observado no `codex-rs` e aceito pelo endpoint.

Para client público, não enviar:

```text
client_secret
organization_id
id_token_add_organizations
```

O `client_secret` só pode ser enviado quando a própria sessão tiver sido criada por um client confidencial real e pelo secret correspondente a esse mesmo client.

### 3. Corrigir o token exchange Codex

O payload deve conter somente os campos do token exchange:

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
client_id=app_EMoamEEZ73f0CkXaXp7hrann
requested_token=openai-api-key
subject_token=<id_token>
subject_token_type=urn:ietf:params:oauth:token-type:id_token
```

Remover a chamada abaixo do fluxo de token exchange:

```java
addOrganizationId(payload);
```

Não enviar no corpo:

```text
organization_id
```

O teste unitário também precisa ser invertido: deve garantir que `organization_id` **não** exista em `buildCodexApiTokenExchangePayload()`.

### 4. Separar configuração browser e device

Para instalação que utiliza somente login por código, a configuração deve ficar equivalente a:

```dotenv
HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
HUB_ACCOUNT_OAUTH_CLIENT_ID=
HUB_ACCOUNT_OAUTH_CLIENT_SECRET=
```

O valor `paulofore` deve ser removido de `HUB_ACCOUNT_OAUTH_CLIENT_ID` e de qualquer secret/configuração de produção.

Caso o login browser seja realmente necessário, `HUB_ACCOUNT_OAUTH_CLIENT_ID` deve conter um client OAuth real iniciado por `app_`, e `HUB_ACCOUNT_OAUTH_CLIENT_SECRET` deve pertencer exatamente a esse client. Esse client browser não pode substituir o client de uma sessão criada por device login.

### 5. Não confundir organização, projeto e workspace

Os identificadores têm finalidades diferentes:

```text
app_...   = client OAuth
org_...   = organização da API Platform
proj_...  = projeto da API Platform
chatgpt_account_id = workspace/conta ChatGPT presente nas claims
```

O valor `org-DgyTLAxNYnw0cOQVlAXInkyR` não é `client_id` e não deve ser usado como `allowed_workspace_id` sem comprovar que corresponde à claim de workspace esperada pelo fluxo Codex.

## Arquivos que precisam ser alterados na implementação

Principalmente:

```text
apps/backend/src/main/java/com/aihub/hub/web/AccountController.java
apps/backend/src/main/java/com/aihub/hub/service/TokenLifecycleManager.java
apps/backend/src/test/java/com/aihub/hub/web/AccountControllerTest.java
apps/backend/src/test/java/com/aihub/hub/service/TokenLifecycleManagerTest.java
```

## Testes mínimos exigidos

1. Device login salva o client público na sessão.
2. Refresh de sessão device usa `app_EMoamEEZ73f0CkXaXp7hrann`.
3. Refresh de sessão device não contém `client_secret`.
4. Refresh não contém `organization_id` nem `id_token_add_organizations`.
5. Token exchange não contém `organization_id`.
6. Sessão browser usa apenas o client que originou os próprios tokens.
7. Um client browser configurado globalmente não sobrescreve o client de uma sessão device.

## Validação operacional após deploy

Depois de aplicar a correção:

1. encerrar a sessão ChatGPT atual;
2. remover cookies/sessão antiga do AI Hub;
3. iniciar novo device login;
4. executar uma nova `CHATGPT_CODEX`;
5. confirmar nos logs que login, authorization-code exchange, refresh e token exchange usam o mesmo `client_id`;
6. confirmar ausência de `invalid_client`;
7. confirmar ausência de `Unknown parameter: 'organization_id'`;
8. confirmar que o sandbox registra a chamada `responses.create`.

## Resultado esperado

O client correto para toda a cadeia de uma sessão criada por device login é:

```text
app_EMoamEEZ73f0CkXaXp7hrann
```

O valor abaixo está incorreto nesse fluxo e deve ser eliminado da configuração:

```text
paulofore
```

A correção definitiva é manter a identidade do client vinculada à sessão, não tentar adivinhar o client durante o refresh e não enviar `organization_id` como parâmetro do token exchange.