# Sandbox Orchestrator

Serviço responsável por receber solicitações do backend do AI Hub e retornar o slug de uma sandbox associada ao repositório original. A versão inicial mantém o slug em memória e aplica prefixo/sufixo configuráveis para diferenciar ambientes temporários.

## Scripts disponíveis

- `npm start`: inicia o servidor em modo de produção.
- `npm run dev`: inicia o servidor com `node --watch` (hot reload simples).
- `npm test`: executa a suíte de testes baseada em `node:test`.

### Endpoints

- `POST /api/v1/sandboxes/ensure`: garante que um slug base possua o sufixo/prefixo configurado e retorna a versão armazenada em cache.
- `POST /api/v1/sandboxes/ensure-branch`: semelhante ao endpoint anterior, mas gera um slug único por branch (`{prefix}{slug}-{branch}{suffix}`), preservando o valor em cache para chamadas subsequentes com a mesma combinação de slug e branch.

## Variáveis de ambiente

| Variável | Descrição | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP exposta pelo serviço | `8080` |
| `SANDBOX_SLUG_PREFIX` | Prefixo aplicado antes do slug original | *(vazio)* |
| `SANDBOX_SLUG_SUFFIX` | Sufixo aplicado após o slug original | `-sandbox` |

## Docker

O Dockerfile publicado pela pipeline gera uma imagem enxuta baseada em `node:20-alpine`. Para executar localmente:

```bash
docker build -t sandbox-orchestrator apps/sandbox-orchestrator
docker run --rm -p 8080:8080 sandbox-orchestrator
```

Com Docker Compose (na raiz do monorepo) o serviço é iniciado automaticamente com o backend e frontend.
