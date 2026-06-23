# Fase 5 — validação de produção Codex App Server

## Por que esta fase existe?

A causa raiz do problema original foi o backend do AI Hub tentar gerenciar autenticação ChatGPT/Codex por OAuth próprio, incluindo refresh/token exchange manual e sessão HTTP local. Em produção, a fase 5 precisa provar que a posse da autenticação e da execução ficou no sandbox-orchestrator/Codex App Server, e que o backend não chama mais `/oauth/token`.

## Checklist operacional

1. Encerrar sessões antigas pelo fluxo App Server:
   - `POST /api/account/logout` deve encaminhar `account/logout` ao sandbox-orchestrator quando `CODEX_APP_SERVER_ENABLED=true`.
2. Limpar configurações OAuth legadas do ambiente de produção:
   - remover `HUB_ACCOUNT_OAUTH_AUTHORIZE_URL`;
   - remover `HUB_ACCOUNT_OAUTH_TOKEN_URL`;
   - remover `HUB_ACCOUNT_OAUTH_CLIENT_ID`;
   - remover `HUB_ACCOUNT_OAUTH_CLIENT_SECRET`;
   - remover `HUB_ACCOUNT_OAUTH_DEVICE_CLIENT_ID`;
   - remover `HUB_ACCOUNT_OAUTH_ORGANIZATION_ID`;
   - remover `HUB_ACCOUNT_OAUTH_SCOPES`.
3. Habilitar o App Server:
   - `CODEX_APP_SERVER_ENABLED=true` no backend e no sandbox-orchestrator;
   - `CODEX_HOME=/var/lib/ai-hub/codex` no sandbox-orchestrator;
   - volume persistente montado em `CODEX_HOME`.
4. Reiniciar backend e sandbox-orchestrator.
5. Realizar login pelo novo fluxo:
   - `POST /api/account/login/start`;
   - abrir `verificationUrl` e informar `userCode`;
   - confirmar em `GET /api/account/read` que `connected=true` e `executable=true`.
6. Reiniciar os serviços novamente e confirmar persistência:
   - `GET /api/account/read` deve continuar executável após restart.
7. Executar uma `CodexRequest` real com perfil `CHATGPT_CODEX`.
8. Confirmar nos logs sanitizados do sandbox-orchestrator:
   - `thread/start`;
   - `turn/start`;
   - `turn/completed`.
9. Confirmar nos logs do backend:
   - nenhuma chamada manual a `/oauth/token`.

## Evidência coletada nesta execução

- MCP healthcheck respondeu `{"status":"UP"}`.
- Containers observados: `ai-hub-6-backend-1` e `ai-hub-6-sandbox-orchestrator-1` estavam em execução.
- A tentativa de alterar `/host/root/ai-hub-6/.env` via MCP falhou porque o filesystem exposto ao MCP está em modo somente leitura.
- Antes do deploy desta alteração, o ambiente ainda expunha variáveis `HUB_ACCOUNT_OAUTH_*`; elas precisam ser removidas no host com acesso de escrita antes da validação final.
- Nos últimos logs consultados do backend não foi encontrada ocorrência de `/oauth/token`.
- Nos últimos logs consultados do sandbox-orchestrator ainda não havia `thread/start`, `turn/start` ou `turn/completed`, portanto a execução real da fase 5 ainda depende de deploy, limpeza do `.env`, login humano pelo device code e disparo de uma request real.

## Comandos MCP usados para validação

```bash
curl -fsS https://iahub.xyz/mcp
```

```bash
curl -fsS -X POST https://iahub.xyz/mcp/tools/linux-command \
  -H 'Content-Type: application/json' \
  --data '{"command":"docker ps --format {{.Names}}"}'
```

```bash
curl -fsS -X POST https://iahub.xyz/mcp/tools/linux-command \
  -H 'Content-Type: application/json' \
  --data '{"command":"docker logs --tail 500 ai-hub-6-backend-1 2>&1 | grep -i '\''/oauth/token'\'' || true"}'
```

```bash
curl -fsS -X POST https://iahub.xyz/mcp/tools/linux-command \
  -H 'Content-Type: application/json' \
  --data '{"command":"docker logs --tail 500 ai-hub-6-sandbox-orchestrator-1 2>&1 | grep -E '\''thread/start|turn/start|turn/completed|Codex App Server'\'' || true"}'
```
