# Plano definitivo — corrigir autenticação e execução `CHATGPT_CODEX` com Codex App Server

## Status

- **Prioridade:** crítica
- **Tipo:** correção de arquitetura e causa raiz
- **Escopo:** autenticação ChatGPT, estado de conta e execução do perfil `CHATGPT_CODEX`
- **Não alterar:** o fluxo `OPENAI_API` baseado em API key, exceto para separar claramente os dois perfis

## Objetivo deste documento

Este documento é uma instrução de implementação. O modelo ou desenvolvedor que executar o trabalho deve seguir a ordem, os limites e os critérios de aceite definidos aqui.

A correção não deve continuar tentando ajustar parâmetros isolados do OAuth atual. O objetivo é remover do AI Hub a responsabilidade de reproduzir internamente o fluxo privado do Codex e passar a usar o **Codex App Server** como dono da autenticação ChatGPT e da execução Codex.

Referências oficiais obrigatórias antes de implementar:

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Autenticação do Codex](https://developers.openai.com/codex/auth)

## Regra obrigatória de investigação

Antes de alterar código, responda explicitamente:

> **Por que esse erro aconteceu?**

Resposta confirmada pelos registros `713`, `714`, `717` e `718`:

1. o AI Hub implementou por conta própria partes do login, refresh e token exchange usados pelo Codex;
2. clientes OAuth diferentes foram misturados durante a vida da mesma sessão;
3. depois de corrigir o `client_id`, o sistema continuou dependendo de uma claim `organization_id` no `id_token` e de um token exchange manual;
4. a aplicação marcou a conta como conectada mesmo quando não possuía uma credencial executável para o perfil `CHATGPT_CODEX`;
5. mesmo sem credencial válida, a requisição foi enviada ao sandbox, criando uma execução que nunca chegou ao modelo.

Evidências detalhadas:

- `docs/diario/dialogo-openai-codex-713.md`
- `docs/diario/dialogo-openai-codex-714.md`
- `docs/diario/dialogo-openai-codex-717.md`
- `docs/diario/dialogo-openai-codex-718.md`
- `docs/diario/correcao-oauth-codex-client-id.md`

## Decisão arquitetural obrigatória

### Perfil `OPENAI_API`

Continuará usando:

- OpenAI Platform API key;
- SDK oficial da OpenAI;
- Responses API;
- cobrança e controles da organização da API Platform.

### Perfil `CHATGPT_CODEX`

Passará a usar:

- processo `codex app-server`;
- autenticação gerenciada pelo próprio Codex;
- JSON-RPC do App Server;
- `account/read`, `account/login/start`, `account/login/completed`, `account/updated` e `account/logout`;
- `thread/start` e `turn/start` para execução;
- notificações do App Server para acompanhar a execução até `turn/completed`.

### Proibição

O perfil `CHATGPT_CODEX` **não pode**:

- chamar diretamente `https://auth.openai.com/oauth/token` pelo backend do AI Hub;
- montar manualmente a URL de autorização da OpenAI;
- manter lógica própria de refresh token do Codex;
- trocar `id_token` por `openai-api-key` manualmente;
- procurar ou exigir `organization_id` dentro do JWT para decidir se pode executar;
- enviar `organization_id`, `id_token_add_organizations` ou `allowed_workspace_id` a endpoints de token;
- usar `accountHint` como identidade autenticada;
- continuar uma execução sem autenticação válida;
- fazer fallback silencioso de `CHATGPT_CODEX` para API key ou para execução sem token.

## Arquitetura alvo

### Dono do App Server

O processo `codex app-server` deve ser gerenciado pelo módulo **`apps/sandbox-orchestrator`**, porque esse módulo:

- já prepara o checkout do repositório;
- conhece o diretório de trabalho real usado pela execução;
- já gerencia o ciclo de vida dos jobs;
- já recebe as solicitações do backend;
- é o local correto para iniciar `thread/start` com o `cwd` do repositório.

O backend não deve executar o agente Codex diretamente. Ele deve atuar como fachada HTTP e cliente do sandbox-orchestrator.

### Transporte

Usar **stdio**, que é o transporte padrão e estável do App Server:

```bash
codex app-server --listen stdio://
```

Não usar WebSocket remoto nesta correção. A documentação oficial classifica esse transporte como experimental e não suportado. Como o cliente e o App Server estarão no mesmo container/processo supervisor, stdio é mais simples e reduz exposição de rede.

### Processo de longa duração

Criar um supervisor no sandbox-orchestrator que:

1. inicia um processo único do App Server;
2. mantém stdin e stdout abertos;
3. lê uma mensagem JSON por linha;
4. correlaciona respostas pelo campo `id`;
5. distribui notificações sem `id` para os listeners corretos;
6. detecta encerramento inesperado;
7. reinicia com backoff limitado;
8. invalida requests pendentes quando o processo morre;
9. publica estado de saúde (`starting`, `ready`, `degraded`, `stopped`).

## Novo componente obrigatório no sandbox-orchestrator

Criar, preferencialmente:

```text
apps/sandbox-orchestrator/src/codexAppServerClient.ts
```

Responsabilidades mínimas:

```ts
interface CodexAppServerClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
  request<T>(method: string, params?: unknown): Promise<T>;
  onNotification(method: string, listener: (params: unknown) => void): () => void;
}
```

O nome pode variar, mas as responsabilidades não podem ser espalhadas pelo `jobProcessor.ts`.

### Handshake obrigatório

Após iniciar o processo, enviar uma única vez por conexão:

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "ai_hub",
      "title": "AI Hub",
      "version": "1.0.0"
    }
  }
}
```

Depois de receber sucesso, enviar a notificação:

```json
{
  "method": "initialized",
  "params": {}
}
```

Observações obrigatórias:

- o protocolo do App Server usa mensagens no formato JSON-RPC, mas omite `"jsonrpc":"2.0"` no wire;
- nenhuma outra chamada pode ocorrer antes de `initialize` + `initialized`;
- não ativar `experimentalApi` nesta primeira correção;
- IDs devem ser monotônicos ou UUIDs e nunca reutilizados enquanto houver request pendente.

## Persistência e segurança das credenciais

O Codex gerencia e renova as credenciais. O AI Hub não deve copiar tokens para sua sessão HTTP nem gravá-los no banco.

Configurar no container do sandbox-orchestrator:

```text
CODEX_HOME=/var/lib/ai-hub/codex
```

Adicionar volume persistente dedicado, por exemplo:

```yaml
volumes:
  codex-auth-data:

services:
  sandbox-orchestrator:
    environment:
      CODEX_HOME: /var/lib/ai-hub/codex
    volumes:
      - codex-auth-data:/var/lib/ai-hub/codex
```

Requisitos:

- o volume não pode ser montado no frontend;
- `auth.json` nunca pode aparecer em logs, responses HTTP, banco, comentários ou artefatos;
- o diretório deve ter permissões restritas;
- nenhum token pode ser enviado do sandbox-orchestrator ao backend;
- o backup desse volume deve ser tratado como segredo;
- não versionar `auth.json`.

## Fluxo de autenticação correto

### Escolha de modalidade

Como o AI Hub roda em servidor/container remoto, usar inicialmente **device code** como modalidade padrão, pois o callback localhost do fluxo browser pode ser frágil em ambiente remoto.

Importante: os incidentes anteriores ocorreram em uma implementação manual do device flow. Isso não autoriza concluir que `chatgptDeviceCode` do App Server está quebrado. O novo fluxo deve delegar toda a cerimônia ao App Server.

### Início do device login

Enviar ao App Server:

```json
{
  "method": "account/login/start",
  "id": 10,
  "params": {
    "type": "chatgptDeviceCode"
  }
}
```

Esperar uma resposta contendo:

- `type`;
- `loginId`;
- `verificationUrl`;
- `userCode`.

O frontend recebe apenas esses campos seguros.

### Conclusão do login

O AI Hub **não deve fazer polling direto em endpoints privados da OpenAI**. Deve aguardar a notificação do App Server:

```json
{
  "method": "account/login/completed",
  "params": {
    "loginId": "<id>",
    "success": true,
    "error": null
  }
}
```

Também deve consumir:

```json
{
  "method": "account/updated",
  "params": {
    "authMode": "chatgpt",
    "planType": "plus"
  }
}
```

Depois da conclusão, confirmar o estado chamando:

```json
{
  "method": "account/read",
  "id": 11,
  "params": {
    "refreshToken": false
  }
}
```

### Browser login

O modo browser pode ser adicionado depois, usando exclusivamente:

```json
{
  "method": "account/login/start",
  "id": 12,
  "params": {
    "type": "chatgpt"
  }
}
```

O frontend deve abrir exatamente o `authUrl` retornado pelo App Server. Não montar, alterar ou completar essa URL.

Antes de habilitar browser login em produção, validar que o callback produzido pelo App Server é acessível no desenho remoto adotado. Se não for, manter device code.

### Logout

Enviar:

```json
{
  "method": "account/logout",
  "id": 13
}
```

Depois, chamar novamente `account/read` e atualizar a UI.

## Contrato HTTP do AI Hub para o frontend

Manter os caminhos `/api/account/*` para evitar quebra desnecessária da UI, mas reescrever a implementação como proxy do App Server.

### `GET /api/account/read`

Resposta recomendada:

```json
{
  "connected": true,
  "status": "connected",
  "authMode": "chatgpt",
  "planType": "plus",
  "requiresOpenaiAuth": true,
  "loginInProgress": false,
  "loginMode": "chatgptDeviceCode",
  "executable": true,
  "blockReason": null
}
```

Regras:

- `connected` deve vir do resultado real de `account/read`;
- `executable` só pode ser `true` quando o App Server estiver inicializado e a conta exigida estiver presente;
- não deduzir conexão por e-mail + data local;
- não fabricar e-mail usando `accountHint`;
- não expor access token, refresh token ou ID token.

### `POST /api/account/login/start`

Body:

```json
{
  "type": "chatgptDeviceCode"
}
```

Resposta:

```json
{
  "status": "authorization_pending",
  "loginId": "<id>",
  "verificationUrl": "https://auth.openai.com/codex/device",
  "userCode": "ABCD-1234"
}
```

O backend deve pedir esses dados ao sandbox-orchestrator, que os obtém do App Server.

### `POST /api/account/login/cancel`

Encaminhar `account/login/cancel` com o `loginId` correspondente.

### `POST /api/account/logout`

Encaminhar `account/logout` ao App Server.

### Remover callback OAuth próprio

A rota customizada abaixo deixa de ser dona do OAuth:

```text
GET /api/account/login/callback
```

Ela deve ser removida quando não houver dependência restante. Não manter duas implementações de autenticação concorrendo entre si.

## Multiusuário e multiconta

A primeira entrega deve assumir **uma identidade Codex por instância do sandbox-orchestrator**.

Motivo: o cache de autenticação pertence ao `CODEX_HOME`. Simplesmente guardar vários e-mails no frontend não cria isolamento de credenciais.

Até existir isolamento real:

- remover o rótulo de “multi-conta” da UI;
- remover a lista de e-mails conhecidos como mecanismo de seleção de credencial;
- não usar `accountHint` para definir o usuário conectado;
- documentar claramente que logout/login troca a conta ativa da instância.

Para multiconta futuro, usar uma destas opções:

1. processo App Server + `CODEX_HOME` isolado por usuário/tenant;
2. workers dedicados por identidade;
3. modo empresarial oficialmente suportado com tokens de acesso Codex e isolamento por tenant.

Não implementar multiconta compartilhando o mesmo `auth.json`.

## Fluxo de execução `CHATGPT_CODEX`

### Pré-condição

Antes de criar ou despachar o job:

1. App Server precisa estar `ready`;
2. `account/read` precisa indicar conta ChatGPT ativa;
3. o perfil deve ser exatamente `CHATGPT_CODEX`;
4. o checkout e o `cwd` precisam existir;
5. modelo solicitado precisa ser aceito pelo App Server.

Se qualquer item falhar, responder erro funcional e **não criar job no sandbox**.

### Início da thread

Depois de preparar o repositório, enviar:

```json
{
  "method": "thread/start",
  "id": 20,
  "params": {
    "model": "<modelo-validado>",
    "cwd": "/workspace/repos/<job>",
    "approvalPolicy": "never",
    "sandbox": "workspaceWrite",
    "serviceName": "ai_hub"
  }
}
```

Usar o `thread.id` retornado.

Não copiar cegamente nomes de modelos antigos. A implementação deve consultar o catálogo/contrato atual do Codex e rejeitar modelo inválido com mensagem clara.

### Início do turno

Enviar:

```json
{
  "method": "turn/start",
  "id": 21,
  "params": {
    "threadId": "<thread-id>",
    "input": [
      {
        "type": "text",
        "text": "<prompt-do-usuario>"
      }
    ]
  }
}
```

### Eventos

Consumir e persistir, no mínimo:

- `item/started`;
- `item/completed`;
- `item/agentMessage/delta`;
- eventos de comando/tool;
- solicitações de aprovação, se habilitadas futuramente;
- `turn/completed`.

Mapear `turn/completed` para o estado final da `CodexRequest`.

A execução só pode ser marcada como concluída com sucesso quando o App Server informar conclusão bem-sucedida. Processo iniciado, thread criada ou primeiro delta não significam sucesso final.

### Imagens

O frontend atual aceita imagens. Não inventar um schema próprio para o App Server.

Antes de manter essa funcionalidade no perfil `CHATGPT_CODEX`:

1. confirmar o tipo de input de imagem suportado pela versão instalada do App Server;
2. criar teste de integração;
3. rejeitar de forma clara anexos não suportados.

Não descartar imagens silenciosamente.

## Separação no `jobProcessor.ts`

O código deve ter dois caminhos explícitos:

```ts
switch (job.profile) {
  case 'CHATGPT_CODEX':
    return runWithCodexAppServer(job);
  case 'OPENAI_API':
  default:
    return runWithOpenAIResponsesApi(job);
}
```

Regras:

- `runWithCodexAppServer` não recebe API key e não instancia `new OpenAI(...)` para executar o turno;
- `runWithOpenAIResponsesApi` não acessa o cache de autenticação ChatGPT;
- nenhuma exceção em um perfil pode provocar fallback silencioso para o outro;
- ambos podem reutilizar código neutro de checkout, persistência de status e coleta de artefatos.

## Alterações obrigatórias por módulo

### `apps/sandbox-orchestrator`

Criar:

- `src/codexAppServerClient.ts`;
- `src/codexAppServerAuth.ts` ou componente equivalente para estado de login;
- testes unitários do framing JSONL, correlação de IDs e notificações.

Alterar:

- `src/jobProcessor.ts` para separar `CHATGPT_CODEX` de Responses API;
- `src/types.ts` para representar login, thread, turn e erro funcional;
- servidor HTTP interno para expor operações de conta ao backend;
- Dockerfile para instalar uma versão fixada e verificável do Codex CLI/App Server.

### `apps/backend`

Alterar:

- `AccountController.java`: remover a implementação manual de OAuth e transformá-lo em fachada do App Server;
- `SandboxOrchestratorClient`: adicionar métodos de account/login/logout/status, ou criar `CodexAppServerGatewayClient` dedicado;
- `CodexRequestService.java`: bloquear criação/despacho quando `CHATGPT_CODEX` não estiver executável;
- DTOs de conta para refletir `authMode`, `planType`, `loginId`, `executable` e `blockReason`.

Retirar do caminho `CHATGPT_CODEX`:

- `TokenLifecycleManager.getValidCodexApiTokenFromCurrentSession()`;
- `buildCodexApiTokenExchangePayload()`;
- parsing manual de JWT;
- validação manual de `organization_id`;
- refresh manual de tokens ChatGPT;
- envio de token OAuth no payload do job.

O `TokenLifecycleManager` só deve permanecer se ainda servir a outro fluxo claramente separado. Caso contrário, removê-lo depois que os testes provarem que não há uso restante.

### `apps/frontend`

Alterar `CodexChatgptPage.tsx`:

- consumir o novo estado real da conta;
- usar device code por padrão;
- mostrar `verificationUrl` e `userCode`;
- reagir a `login/completed` via polling do backend ou canal de eventos do AI Hub;
- remover campo de e-mail obrigatório;
- remover “multi-conta” falso;
- bloquear execução quando `executable=false`;
- exibir `blockReason` sem mensagens genéricas;
- não considerar apenas `connected=true` suficiente se o App Server estiver indisponível.

### Infraestrutura

Alterar:

- `docker-compose.yml` para volume persistente de `CODEX_HOME`;
- Dockerfile do sandbox-orchestrator para instalar Codex;
- workflow de CI para testar a inicialização do App Server;
- healthcheck do sandbox-orchestrator para incluir o estado do processo App Server, sem expor segredos.

## Variáveis antigas

Depois da migração, remover do fluxo `CHATGPT_CODEX`:

```text
HUB_ACCOUNT_OAUTH_CLIENT_ID
HUB_ACCOUNT_OAUTH_CLIENT_SECRET
HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID
HUB_ACCOUNT_OAUTH_ORGANIZATION_ID
```

Não substituir esses valores por novos valores “tentativos”. O App Server deve possuir os detalhes do login.

Se houver restrição administrativa de workspace, usar configuração oficial do Codex, por exemplo `forced_login_method` e `forced_chatgpt_workspace_id`, somente com o identificador real do workspace ChatGPT. Não assumir que um `org_...` da API Platform é o mesmo identificador do workspace ChatGPT.

## Estado e erros

Criar erros funcionais distintos:

- `CODEX_APP_SERVER_UNAVAILABLE`;
- `CODEX_NOT_AUTHENTICATED`;
- `CODEX_LOGIN_IN_PROGRESS`;
- `CODEX_LOGIN_FAILED`;
- `CODEX_MODEL_UNSUPPORTED`;
- `CODEX_THREAD_START_FAILED`;
- `CODEX_TURN_FAILED`;
- `CODEX_TURN_INTERRUPTED`.

Não transformar todos em `500` genérico. Usar status HTTP coerentes, por exemplo:

- `401` quando autenticação é necessária;
- `409` quando login já está em andamento ou estado conflita;
- `422` para modelo/input não suportado;
- `503` quando App Server não está pronto.

## Observabilidade obrigatória

Registrar sem segredos:

- início/reinício/parada do App Server;
- duração do handshake;
- método JSON-RPC e `requestId`, sem payload sensível;
- `loginId` e resultado do login;
- `threadId`, `turnId` e `CodexRequest.id` correlacionados;
- tempo até primeiro evento;
- duração total;
- status final de `turn/completed`;
- motivo funcional de bloqueio.

Nunca registrar:

- access token;
- refresh token;
- ID token;
- conteúdo de `auth.json`;
- cookies;
- headers de autorização;
- URL de autenticação completa se contiver parâmetros sensíveis.

## Migração em fases

### Fase 0 — congelar o fluxo legado

- adicionar feature flag `CODEX_APP_SERVER_ENABLED`;
- impedir novas tentativas de “corrigir” o token exchange manual;
- preservar o perfil `OPENAI_API`.

### Fase 1 — cliente App Server e saúde

- instalar Codex no sandbox-orchestrator;
- implementar processo stdio;
- implementar handshake;
- implementar `account/read`;
- adicionar testes e healthcheck.

### Fase 2 — autenticação

- implementar `chatgptDeviceCode`;
- reescrever endpoints `/api/account/*` como proxy;
- atualizar frontend;
- validar persistência após restart.

### Fase 3 — execução

- implementar `thread/start`;
- implementar `turn/start`;
- consumir eventos;
- mapear resposta e status para `CodexRequest`;
- impedir qualquer dispatch sem readiness.

### Fase 4 — remoção do legado

- remover OAuth manual do `AccountController`;
- retirar `TokenLifecycleManager` do perfil ChatGPT;
- remover variáveis antigas;
- remover callback próprio;
- remover e-mail/multiconta fictícios da UI.

### Fase 5 — produção

- logout e remoção das sessões HTTP antigas;
- limpar configurações OAuth legadas;
- realizar login pelo novo fluxo;
- reiniciar serviços e confirmar persistência;
- executar uma request real;
- confirmar que existe `thread/start`, `turn/start` e `turn/completed` nos logs sanitizados;
- confirmar que não existem chamadas manuais a `/oauth/token` pelo backend.

## Testes mínimos obrigatórios

### Unitários — cliente App Server

- [ ] envia `initialize` antes de qualquer outro método;
- [ ] envia `initialized` após sucesso;
- [ ] correlaciona respostas fora de ordem pelo `id`;
- [ ] trata notificações sem confundi-las com responses;
- [ ] rejeita promises pendentes quando o processo termina;
- [ ] reinicia com backoff limitado;
- [ ] não registra dados sensíveis.

### Unitários — backend

- [ ] `account/read` não usa e-mail + data para fabricar conexão;
- [ ] `login/start` encaminha `chatgptDeviceCode`;
- [ ] logout é encaminhado ao App Server;
- [ ] `CHATGPT_CODEX` não chama `TokenLifecycleManager`;
- [ ] request não é criada/despachada quando `executable=false`;
- [ ] não existe fallback silencioso para outro perfil.

### Integração

Usar um processo fake de App Server por JSONL para testar:

- [ ] handshake;
- [ ] login pendente e concluído;
- [ ] account update;
- [ ] thread start;
- [ ] turn start;
- [ ] deltas de mensagem;
- [ ] turn completed com sucesso;
- [ ] turn completed com erro;
- [ ] queda do processo no meio do turno.

### Produção controlada

- [ ] login device code conclui;
- [ ] `account/read` permanece conectado após restart;
- [ ] execução chega ao modelo;
- [ ] resposta é persistida;
- [ ] logout remove a autenticação ativa;
- [ ] nenhuma credencial aparece nos logs;
- [ ] nenhuma chamada manual do backend a `/oauth/token` ocorre.

## Critérios de aceite finais

A correção só está concluída quando todos forem verdadeiros:

1. `CHATGPT_CODEX` autentica por meio do Codex App Server.
2. O backend não implementa OAuth da OpenAI para esse perfil.
3. O sandbox não recebe token ChatGPT produzido pelo backend.
4. O App Server gerencia cache e renovação da sessão.
5. A aplicação não depende de `organization_id` em JWT próprio.
6. O estado da UI vem de `account/read` do App Server.
7. Uma request não pode ser criada/despachada sem readiness real.
8. `CHATGPT_CODEX` executa via `thread/start` + `turn/start`.
9. `OPENAI_API` continua isolado e funcional.
10. Os testes unitários, integração e validação operacional passam.
11. Os registros demonstram `turn/completed` e não apenas login bem-sucedido.
12. Não existe fallback silencioso ou execução “sem token”.

## Coisas que o implementador não deve fazer

- Não tentar obter um novo `client_id` aleatório.
- Não usar nome de usuário, e-mail, API key, `org_...` ou `proj_...` como OAuth client ID.
- Não adicionar novamente `organization_id` ao refresh ou token exchange.
- Não copiar o fluxo privado observado em `codex-rs` para Java/TypeScript.
- Não usar o client de device como fallback para um OAuth browser próprio.
- Não marcar conta como conectada com base em `accountHint`.
- Não enviar job quando a autenticação necessária não está pronta.
- Não manter dois donos da autenticação ao mesmo tempo.
- Não declarar sucesso sem uma execução real terminar em `turn/completed`.

## Resultado esperado

Após a implementação, o AI Hub continuará oferecendo a tela `/codex-chatgpt`, mas a tela será apenas cliente da integração oficial:

```text
Frontend
  -> Backend /api/account e /api/codex
    -> Sandbox Orchestrator
      -> codex app-server (stdio)
        -> autenticação ChatGPT gerenciada pelo Codex
        -> thread/start
        -> turn/start
        -> eventos
        -> turn/completed
```

O perfil de API Platform continuará separado:

```text
Frontend
  -> Backend /api/codex
    -> Sandbox Orchestrator
      -> OpenAI SDK
        -> Responses API com API key
```

Essa separação elimina a causa raiz: o AI Hub deixa de tentar transformar manualmente tokens de login ChatGPT em credenciais da API e passa a usar o componente oficial que já gerencia autenticação, sessão e execução Codex.