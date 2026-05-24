# MCP Server

Módulo Spring Boot para expor tools MCP via HTTP.

## Endpoint de comando Linux

- `POST /mcp/tools/linux-command`
- O comando é executado no container do MCP Server via `/bin/bash -lc`.
- Para visibilidade de todo o filesystem do host, o `docker-compose` monta a raiz `/` do host em `/host` (somente leitura); use comandos como `ls /host`, `find /host/...` etc.
- Com o socket Docker montado (`/var/run/docker.sock`) e Docker CLI disponível, o endpoint também pode consultar logs de containers do host (ex.: `docker logs <container>`).
- Body:

```json
{
  "command": "uname -a"
}
```
