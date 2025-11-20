# Sandbox Orchestrator

Serviço responsável por receber solicitações do backend do AI Hub e retornar o slug de uma sandbox associada ao repositório original. A versão inicial mantém o slug em memória e aplica prefixo/sufixo configuráveis para diferenciar ambientes temporários.

## Scripts disponíveis

- `npm start`: inicia o servidor em modo de produção.
- `npm run dev`: inicia o servidor com `node --watch` (hot reload simples).
- `npm test`: executa a suíte de testes baseada em `node:test`.

### Endpoints

- `POST /api/v1/sandboxes/ensure`: garante que um slug base possua o sufixo/prefixo configurado e retorna a versão armazenada em cache junto com credenciais de acesso ao sandbox.
- `POST /api/v1/sandboxes/ensure-branch`: semelhante ao endpoint anterior, mas gera um slug único por branch (`{prefix}{slug}-{branch}{suffix}`), preservando o valor em cache para chamadas subsequentes com a mesma combinação de slug e branch e retornando os endpoints/credenciais provisionados.
- `POST /api/v1/jobs`: registra uma nova execução solicitada pelo backend (`jobId`, `repoUrl`, `branch` e `task` são obrigatórios), provisiona ou reutiliza uma conexão de sandbox e devolve um payload contendo status e metadados da execução. Chamadas com o mesmo `jobId` são idempotentes e retornam o job já armazenado.

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

O `expiresAt` é um timestamp em epoch milliseconds calculado a partir do `SANDBOX_TTL_SECONDS`. Campos como `cpuLimit`, `memoryLimit` e `image` são utilizados internamente pelo provedor para criar a sandbox, mas não precisam ser consumidos diretamente pelo serviço chamador.

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
