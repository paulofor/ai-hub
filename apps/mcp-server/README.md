# MCP Server

Módulo Spring Boot para expor tools MCP via HTTP.

## Endpoint de comando Linux

- `POST /mcp/tools/linux-command`
- Header obrigatório: `X-MCP-TOKEN: <token>`
- Body:

```json
{
  "command": "uname -a"
}
```
