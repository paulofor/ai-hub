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

## Autenticação e superfície pública

- Todas as rotas `/mcp/tools/**` exigem `Authorization: Bearer <MCP_SERVER_API_TOKEN>`.
- Quando o token não está configurado, as tools respondem `503`; não há modo fail-open.
- O Caddy bloqueia publicamente `/mcp/tools/linux-command` com `404`.
- O shell continua disponível somente em `http://mcp-server:8084/mcp/tools/linux-command`, na rede
  interna, para consumidores legados autenticados do AI Hub. O timeout padrão é 30 segundos e a
  saída máxima é 20000 caracteres.

## Recuperação controlada do proxy público

- `POST /mcp/tools/recover-public-proxy`
- Entrada fechada:

```json
{
  "requestId": "13f03b59-67db-4a43-872f-e0294a72270b",
  "reason": "Proxy público indisponível após reboot",
  "confirmation": "RECOVER_PUBLIC_PROXY"
}
```

- Repositório, workflow, branch, host, projeto Compose e serviço não são aceitos no payload.
- `GET /mcp/tools/recover-public-proxy/{requestId}` acompanha o estado.
- A operação só retorna `RECOVERED` quando o workflow GitHub conclui com sucesso suas sondas de
  HTTPS, health e contrato PDE.

Exemplo de solicitação explicitamente autorizada:

```bash
curl -fsS https://iahub.xyz/mcp/tools/recover-public-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MCP_SERVER_API_TOKEN}" \
  -d '{"requestId":"13f03b59-67db-4a43-872f-e0294a72270b","reason":"Proxy público indisponível após reboot","confirmation":"RECOVER_PUBLIC_PROXY"}'
```

Consulta:

```bash
curl -fsS https://iahub.xyz/mcp/tools/recover-public-proxy/13f03b59-67db-4a43-872f-e0294a72270b \
  -H "Authorization: Bearer ${MCP_SERVER_API_TOKEN}"
```
