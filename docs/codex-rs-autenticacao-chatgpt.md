# Codex-RS: passo a passo da autenticação com login ChatGPT e uso do modelo

Este documento descreve, com base no código de `exemplos/codex-rs`, como funciona o fluxo de autenticação via conta ChatGPT e como o token resultante é usado para acessar modelos.

## 1) Visão geral da arquitetura

No crate `login`, o projeto expõe dois fluxos principais:

1. **Login interativo com navegador** (OAuth + callback local).
2. **Login por device code** (usuário autoriza em outro navegador/dispositivo).

Depois do login, os tokens são persistidos e carregados pelo `codex-core`, que passa a autenticar chamadas ao backend usando bearer token.

## 2) Fluxo A — login com navegador (ChatGPT)

### Passo 1: inicialização do servidor local de callback

A função `run_login_server(opts)`:

- gera PKCE (`generate_pkce`) e `state` anti-CSRF;
- sobe um servidor HTTP local (padrão em porta `1455`, ou porta disponível);
- monta `redirect_uri` no formato `http://localhost:<porta>/auth/callback`;
- constrói a URL de autorização OAuth com os parâmetros necessários;
- opcionalmente abre o navegador automaticamente.

Resumo: o CLI prepara um endpoint local para receber o retorno do provedor de autenticação.

### Passo 2: usuário autentica no ChatGPT

O usuário faz login pela URL de autorização. Após sucesso, o provedor redireciona para:

`/auth/callback?code=...&state=...`

No callback, o servidor valida `state` antes de continuar.

### Passo 3: troca de authorization code por tokens

Com `code` válido, o fluxo chama a troca (`exchange_code_for_tokens`) e recebe:

- `id_token`
- `access_token`
- `refresh_token`

### Passo 4: validação de workspace (quando configurada)

Se existir `forced_chatgpt_workspace_id`, o fluxo chama `ensure_workspace_allowed(...)` para confirmar que o token pertence ao workspace permitido.

### Passo 5: persistência local

Com os tokens válidos, o login persiste os dados de autenticação (`persist_tokens_async` / `save_auth`) no `codex_home`.

---

## 3) Fluxo B — login por device code

### Passo 1: solicitar código de dispositivo

`request_device_code(opts)` faz POST em:

`/api/accounts/deviceauth/usercode`

com `client_id`, e recebe:

- `device_auth_id`
- `user_code`
- `interval` de polling

### Passo 2: usuário autoriza no navegador

O CLI imprime:

- URL de verificação (`<issuer>/codex/device`)
- código temporário (`user_code`)

O usuário entra na URL e confirma o login.

### Passo 3: polling até autorização

`poll_for_token(...)` faz polling em:

`/api/accounts/deviceauth/token`

até receber sucesso (ou timeout de 15 min).

### Passo 4: exchange final por tokens OAuth

Ao receber `authorization_code`, o fluxo executa `exchange_code_for_tokens(...)` e obtém os tokens finais.

### Passo 5: validação e persistência

Repete o mesmo padrão do fluxo de navegador:

- valida workspace (quando aplicável)
- persiste `id_token`, `access_token` e `refresh_token`

---

## 4) Como o Codex-RS usa esse login para acessar o modelo

Depois que `auth.json` (ou storage equivalente) contém tokens válidos, `codex-core` carrega credenciais e define o modo de autenticação.

### Passo 1: carregar modo de autenticação

`CodexAuth::from_auth_storage(...)` lê credenciais salvas e resolve o `AuthMode`:

- `ApiKey`
- `Chatgpt`
- `ChatgptAuthTokens`

### Passo 2: obter bearer token para chamadas

`CodexAuth::get_token()` retorna:

- API key, se modo API key;
- `access_token`, se modo ChatGPT.

Esse valor é usado como token bearer nas chamadas ao backend/modelo.

### Passo 3: enriquecer contexto de conta/plano via `id_token`

O módulo `token_data` faz parse do JWT (`parse_chatgpt_jwt_claims`) e extrai claims úteis:

- email
- `chatgpt_plan_type`
- `chatgpt_user_id`
- `chatgpt_account_id`

Essas informações permitem comportamento dependente de plano/workspace.

### Passo 4: renovação de token quando necessário

Quando o `access_token` expira, o core usa `refresh_token` no endpoint OAuth (`https://auth.openai.com/oauth/token`, com possibilidade de override por env var) para renovar sessão sem novo login manual.

---

## 5) Sequência resumida (fim a fim)

1. CLI inicia fluxo de login (browser ou device code).
2. Usuário autentica na conta ChatGPT.
3. CLI recebe `authorization_code`.
4. CLI troca código por `id_token + access_token + refresh_token`.
5. CLI valida workspace (se política exigir).
6. CLI persiste credenciais no storage local.
7. `codex-core` carrega credenciais e usa `access_token` como bearer.
8. Requisições ao backend/modelo passam a funcionar com sessão ChatGPT.
9. Quando necessário, o `refresh_token` renova o `access_token`.

## 6) Observações de engenharia

- A proteção por `state` e PKCE reduz risco de interceptação e CSRF no fluxo OAuth.
- O fluxo device code é útil para ambientes sem browser local.
- A separação entre crate `login` (obtenção de tokens) e `core/auth` (uso/renovação) melhora manutenção.

## 7) Gap de implementação no AI Hub (comparado ao codex-rs)

No `codex-rs`, o fluxo completo depende de três peças encadeadas: URL OAuth real, callback com `authorization_code`, e exchange para `id/access/refresh token` com persistência segura.

No AI Hub atual (`/api/account/*`), o fluxo ainda está em modo simulado/MVP:

- `POST /api/account/login/start` não inicia OAuth real; ele retorna `authUrl` apontando para o próprio callback local (`/api/account/login/callback`).
- o callback não recebe nem processa `code`/`state`; ele só grava e-mail em sessão.
- não existe exchange com `/oauth/token`.
- não há armazenamento de `access_token`/`refresh_token` (nem rotação/refresh).

Consequência prática: a percepção de “login sem redirecionamento útil” e “sem token salvo” está correta para o backend atual do AI Hub, porque o fluxo não conclui a etapa de autorização OAuth do ChatGPT nem materializa credenciais de API reutilizáveis.

### O que falta para equivaler ao codex-rs

1. `login/start` gerar URL OAuth real com `redirect_uri`, `state` e PKCE.
2. `login/callback` validar `state` e trocar `authorization_code` por tokens.
3. persistir tokens (`id/access/refresh`) em storage seguro do servidor.
4. expor estado de conexão baseado em token válido (e refresh quando expirar).
5. usar `access_token` bearer no serviço que chama modelo/backend OpenAI.
