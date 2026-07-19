# MCP Server

Módulo Spring Boot para expor tools MCP via HTTP.

## Healthcheck

- `GET /mcp`
- Retorna:

```json
{
  "status": "UP"
}
```

## Endpoint de comando Linux

- `POST /mcp/tools/linux-command`
- Aceita header opcional `Authorization: Bearer <MCP_SERVER_API_TOKEN>`.
- Quando `MCP_SERVER_API_TOKEN` estiver configurado, o bearer passa a ser obrigatório; quando não estiver configurado, a chamada segue o contrato simples com `Content-Type: application/json` e body `{ "command": "<comando>" }`.
- O comando é executado no container do MCP Server via `/bin/bash -lc`.
- Para visibilidade de todo o filesystem do host, o `docker-compose` monta a raiz `/` do host em `/host` (somente leitura); use comandos como `ls /host`, `find /host/...` etc.
- Com o socket Docker montado (`/var/run/docker.sock`) e Docker CLI disponível, o endpoint também pode consultar logs de containers do host (ex.: `docker logs <container>`).
- O timeout padrão é de 30 segundos (`MCP_SERVER_COMMAND_TIMEOUT_SECONDS`) e a saída padrão é limitada a 20000 caracteres (`MCP_SERVER_MAX_OUTPUT_CHARS`).
- Body:

```json
{
  "command": "uname -a"
}
```

Exemplo:

```bash
curl -fsS https://iahub.xyz/mcp/tools/linux-command \
  -H "Content-Type: application/json" \
  -d '{"command":"docker logs --tail 200 ai-hub-6-backend-1"}'
```

Com token configurado:

```bash
curl -fsS https://iahub.xyz/mcp/tools/linux-command \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MCP_SERVER_API_TOKEN}" \
  -d '{"command":"docker logs --tail 200 ai-hub-6-backend-1"}'
```
