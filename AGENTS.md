**Todo trabalho realizado nesse projeto deve ser registrado em : /docs/diario/registros1.md**

**Sempre que for solicitado ajuste de um problema busque a causa raiz no lugar de tentar consertar consequencias**

**Antes de propor ou implementar qualquer ajuste para um erro, pare e se pergunte explicitamente: “por que esse erro aconteceu?”. Use a resposta para guiar a investigação e só então defina a correção.**

**O MCP Server usa autenticação bearer obrigatória e fail-closed em todas as tools. O shell Linux genérico é restrito à rede interna e não deve ser exposto pelo proxy público.**

**Forma correta de acesso ao MCP Server:**
- Healthcheck: `GET https://iahub.xyz/mcp` (retorna `{"status":"UP"}`).
- Recuperação do proxy público: `POST https://iahub.xyz/mcp/tools/recover-public-proxy` com bearer, `requestId` UUID, `reason` e confirmação literal `RECOVER_PUBLIC_PROXY`.
- Consulta da recuperação: `GET https://iahub.xyz/mcp/tools/recover-public-proxy/{requestId}` com bearer.
- `POST /mcp/tools/linux-command` só pode ser usado por serviços internos autenticados; a borda pública deve responder `404`.

**Integração Codex App Server / sandbox mode:**
- Ao montar payloads para o Codex App Server, especialmente `thread/start`, use os valores de sandbox em kebab-case aceitos pelo App Server: `read-only`, `workspace-write` ou `danger-full-access`.
- Nunca envie `workspaceWrite`, `readOnly` ou `dangerFullAccess` para o campo `sandbox` do App Server; esses valores camelCase são legados e causam erro `Invalid request: unknown variant`.

**Acesso a VPS por SSH:**
- Quando precisar acessar uma VPS por SSH e ainda não existir chave cadastrada para a sandbox, gere uma nova chave `ed25519` dentro da sandbox e entregue apenas a chave pública ao usuário para cadastro no host autorizado.
- Nunca solicite ou exponha chave privada, senha SSH ou credenciais reais; use a chave privada gerada somente localmente na sandbox e apenas para acessos explicitamente autorizados.
