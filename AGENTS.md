**Todo trabalho realizado nesse projeto deve ser registrado em : /docs/diario/registros1.md**

**Sempre que for solicitado ajuste de um problema busque a causa raiz no lugar de tentar consertar consequencias**

**O MCP Server permite executar comandos Linux no host e visualizar logs dos containers (ex.: via `docker logs`), respeitando autenticação por token e políticas de segurança do ambiente.**

**Forma correta de acesso ao MCP Server:**
- Healthcheck: `GET https://iahub.xyz/mcp` (retorna `{"status":"UP"}`).
- Execução de comandos/logs: `POST https://iahub.xyz/mcp/tools/linux-command` com header `Content-Type: application/json` e body `{ "command": "<comando>" }`.
- Exemplo para logs do backend: `{ "command": "docker logs --tail 200 ai-hub-6-backend-1" }`.
