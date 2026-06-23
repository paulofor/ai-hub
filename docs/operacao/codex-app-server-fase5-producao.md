# Fase 5 — validação de produção Codex App Server

## Por que esta fase existe?

A causa raiz do problema original foi o backend do AI Hub tentar gerenciar autenticação ChatGPT/Codex por OAuth próprio, incluindo refresh/token exchange manual e sessão HTTP local. Em produção, a fase 5 precisa provar que a posse da autenticação e da execução ficou no sandbox-orchestrator/Codex App Server, e que o backend não chama mais `/oauth/token`.


## O que o workflow já faz e o que é manual

O deploy do GitHub Actions em `main` já executa automaticamente os passos de CI, build/push das imagens Docker, sincronização do repositório para `/root/ai-hub-6`, normalização segura do `.env` operacional do Codex App Server, `docker compose pull` e `docker compose up -d`. O `docker-compose.yml` também já define `CODEX_HOME=/var/lib/ai-hub/codex` no `sandbox-orchestrator` e monta o volume persistente `codex-auth-data` nesse caminho.

Portanto, para sair do estado `CODEX_APP_SERVER_DISABLED`, o caminho preferencial é reexecutar o workflow em `main`; ele preserva um backup do `.env`, remove chaves legadas `HUB_ACCOUNT_OAUTH_*`, remove pins antigos de imagem e grava as imagens atuais `ghcr.io/<GHCR_USERNAME>/ai-hub-6-*`. O procedimento manual abaixo fica como fallback caso o workflow não possa ser executado:

1. Se o workflow não puder ser usado, editar `/root/ai-hub-6/.env` e garantir:
   - `CODEX_APP_SERVER_ENABLED=true`;
   - remoção das variáveis legadas `HUB_ACCOUNT_OAUTH_*`;
   - remoção de pins antigos `BACKEND_IMAGE`, `FRONTEND_IMAGE` e `SANDBOX_ORCHESTRATOR_IMAGE` apontando para `ghcr.io/paulodb/ai-hub-*`, ou troca explícita para as imagens atuais `ghcr.io/paulofor/ai-hub-6-*`.
2. Depois que a alteração estiver no `.env`, preferir reexecutar o workflow de `main`; se a imagem já estiver atualizada e o workflow estiver indisponível, reiniciar os serviços com `docker compose up -d` dentro de `/root/ai-hub-6`.
3. Abrir `/codex-chatgpt`, clicar em **Conectar com ChatGPT**, abrir a `verificationUrl` exibida e informar o `userCode`. Essa autorização humana da conta ChatGPT não é automatizável pelo workflow.
4. Confirmar na própria tela, ou em `GET /api/account/read`, que `connected=true` e `executable=true`.
5. Executar uma request `CHATGPT_CODEX` real e conferir os logs do sandbox-orchestrator (`thread/start`, `turn/start`, `turn/completed`).

Comandos úteis no host, se for fazer via SSH:

```bash
cd /root/ai-hub-6
cp .env .env.backup-$(date +%Y%m%d%H%M%S)
sed -i '/^HUB_ACCOUNT_OAUTH_/d' .env
sed -i '/^CODEX_APP_SERVER_ENABLED=/d' .env
sed -i '/^BACKEND_IMAGE=/d; /^FRONTEND_IMAGE=/d; /^SANDBOX_ORCHESTRATOR_IMAGE=/d; /^CADDY_IMAGE=/d; /^MCP_SERVER_IMAGE=/d' .env
cat >> .env <<'EOF'
CODEX_APP_SERVER_ENABLED=true
BACKEND_IMAGE=ghcr.io/paulofor/ai-hub-6-backend:latest
FRONTEND_IMAGE=ghcr.io/paulofor/ai-hub-6-frontend:latest
SANDBOX_ORCHESTRATOR_IMAGE=ghcr.io/paulofor/ai-hub-6-sandbox:latest
CADDY_IMAGE=ghcr.io/paulofor/ai-hub-6-caddy:latest
MCP_SERVER_IMAGE=ghcr.io/paulofor/ai-hub-6-mcp-server:latest
EOF
docker compose pull backend frontend sandbox-orchestrator caddy mcp-server
docker compose up -d
```

> Observação: no erro observado em 2026-06-23, `CODEX_APP_SERVER_ENABLED=true` já estava presente, mas o `.env` ainda pinava `BACKEND_IMAGE=ghcr.io/paulodb/ai-hub-backend:latest` e `SANDBOX_ORCHESTRATOR_IMAGE=ghcr.io/paulodb/ai-hub-sandbox:latest`; por isso o container continuou servindo o endpoint OAuth legado `redirect_required` em vez do proxy App Server.

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
