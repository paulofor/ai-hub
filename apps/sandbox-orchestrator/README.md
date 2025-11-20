# Sandbox Orchestrator

Serviço responsável por receber jobs do backend do AI Hub, preparar um sandbox temporário (clone do repositório) e orquestrar o loop de tool-calling com o modelo `gpt-5-codex` via Responses API.

## Scripts disponíveis

- `npm start`: inicia o servidor em modo de produção.
- `npm run dev`: inicia o servidor com `node --watch` (hot reload simples).
- `npm test`: executa a suíte de testes baseada em `node:test`.

### Endpoints

- `POST /jobs`: cria um job informando `jobId`, `repoUrl`, `branch`, `task` e (opcionalmente) `testCommand`/`commit`. O serviço clona o repositório num diretório temporário, expõe as tools `run_shell`, `read_file` e `write_file` ao modelo e inicia o loop de tool-calling.
- `GET /jobs/{id}`: retorna o status atualizado do job, incluindo resumo, arquivos alterados e patch gerado quando disponíveis.

### Formato de resposta

Os handlers respondem com o payload mínimo que o `SandboxProvisioningService` espera consumir:

```json
{
  "slug": "owner/repo-branch-sandbox",
  "host": "sandbox.local",
  "port": 9000,
  "token": "abcdef123...",
  "expiresAt": 1700000000000,
  "ttlSeconds": 3600
}
```

Jobs ficam armazenados em memória e carregam metadados como diretório temporário, status, arquivos alterados e patch (`git diff`) final.

## Variáveis de ambiente

| Variável | Descrição | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP exposta pelo serviço | `8080` |
| `SANDBOX_SLUG_PREFIX` | Prefixo aplicado antes do slug original | *(vazio)* |
| `SANDBOX_SLUG_SUFFIX` | Sufixo aplicado após o slug original | `-sandbox` |
| `SANDBOX_IMAGE` | Imagem base utilizada para provisionar o contêiner/VM efêmero | `ghcr.io/ai-hub/sandbox:latest` |
| `SANDBOX_TTL_SECONDS` | Tempo de vida do sandbox antes de ser reciclado | `3600` |
| `SANDBOX_CPU_LIMIT` | Limite de CPU aplicado à sandbox provisionada | `1` |
| `SANDBOX_MEMORY_LIMIT` | Limite de memória aplicado à sandbox provisionada | `512m` |
| `SANDBOX_HOST` | Host exposto para alcançar o sandbox | `127.0.0.1` |
| `SANDBOX_BASE_PORT` | Porta base usada para simular a atribuição incremental de portas | `3000` |

## Docker

O Dockerfile publicado pela pipeline gera uma imagem enxuta baseada em `node:20-alpine`. Para executar localmente:

```bash
docker build -t sandbox-orchestrator apps/sandbox-orchestrator
docker run --rm -p 8080:8080 sandbox-orchestrator
```

Com Docker Compose (na raiz do monorepo) o serviço é iniciado automaticamente com o backend e frontend.
