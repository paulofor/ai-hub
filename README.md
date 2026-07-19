# AI Hub

AI Hub é um monorepo full-stack que centraliza experiências de governança, prompts, análise de falhas e automações Codex via interface web. O projeto combina um backend Spring Boot com um frontend React/Vite, infraestrutura pronta para Docker e AWS Lightsail, além de automações GitHub Actions.

## Visão geral

- **UI-first**: nenhuma ação destrutiva é executada sem confirmação explícita na UI.
- **Integrações GitHub**: criação de repositórios, disparo de workflows, análise de logs, comentários e PRs de correção.
- **OpenAI Responses API**: integração mediada pelo sandbox-orchestrator para gerar correções e relatórios `CiFix` a partir de falhas em pipelines.
- **Persistência**: MySQL 5.7 (produção) com Flyway para auditoria, prompts e respostas.
- **Módulo de projetos descontinuado**: fluxos de criação, catálogo e detalhes de projetos foram removidos para abrir espaço para a próxima geração de experiências.

## Estrutura de pastas

```
apps/
  backend/
  frontend/
  mcp-server/
  sandbox-orchestrator/
infra/
  nginx/
  lightsail/
.github/
  workflows/
```

## Desenvolvimento local

1. Ajuste as variáveis em `.env` na raiz (já versionado com valores padrão compatíveis com a VPS) e, se necessário, personalize também `apps/backend/.env.example` e `apps/frontend/.env.example`. O campo `DB_PASS` já está configurado com a senha atual (`S3nh@Fort3!`); se a senha for rotacionada, atualize o valor nesses arquivos antes de reiniciar os contêineres.
2. Garanta que você tenha um MySQL acessível (pode reutilizar o mesmo da produção ou apontar para outro ambiente) e então execute `docker-compose up --build` para subir backend, frontend e sandbox-orchestrator.
3. Instale o Maven localmente para executar comandos do backend (`mvn test`, `mvn clean package`). A imagem do sandbox já vem com Maven, JDK, Docker CLI, plugin Docker Compose v2 (`docker compose`), AWS CLI, GitHub CLI (`gh`) e `actionlint` pré-instalados; se precisar configurar a sua máquina, siga [este passo a passo](docs/maven-setup.md).
4. A UI estará disponível em `http://localhost:8082`, a API em `http://localhost:8081`, o sandbox-orchestrator em `http://localhost:8083` e o MCP server internamente em `http://mcp-server:8084`.

### Persistência de credenciais OAuth (client_id/client_secret)

- Não use apenas `export ...` no shell para produção: esse valor pode se perder ao reiniciar sessão/servidor.
- Grave `HUB_ACCOUNT_OAUTH_CLIENT_ID` e `HUB_ACCOUNT_OAUTH_CLIENT_SECRET` no arquivo `.env` da raiz (lido pelo `docker-compose`) ou no gerenciador de segredos do ambiente de deploy (ex.: Lightsail).
- Depois de salvar, recrie os contêineres para aplicar: `docker compose up -d --force-recreate backend` (ou stack completa).
- Referências de exemplo: `.env.example` e `apps/backend/.env.example` já incluem essas chaves para evitar deploy com OAuth incompleto.

### Armazenamento do token da OpenAI na VPS

- Para guardar o token da OpenAI em um arquivo físico na VPS, use o caminho `/root/infra/openai-token/openai_api_key` (já esperado pelos contêineres por padrão). Esse diretório é montado como volume somente leitura no `sandbox-orchestrator` e, se o arquivo existir, o conteúdo é exportado como `OPENAI_API_KEY` antes de iniciar o serviço.
- Caso prefira armazenar o arquivo em outro diretório, defina `OPENAI_TOKEN_HOST_DIR` no `.env` apontando para a pasta que contém o `openai_api_key` antes de executar `docker-compose up`.
- Caso o arquivo não esteja presente, o comportamento permanece igual ao anterior: as variáveis de ambiente definidas em `.env` continuam sendo usadas.

### Armazenamento de credenciais GitHub Packages para a sandbox

- Para dependências privadas do GitHub Packages usadas por comandos executados pelo modelo (ex.: Maven), prefira guardar as credenciais fora do repositório em `/root/infra/github-packages`.
- Crie dois arquivos nesse diretório: `github_actor` com o usuário/owner autorizado e `github_token` com um PAT que tenha `read:packages` e acesso ao repositório/pacote privado.
- O `sandbox-orchestrator` monta esse diretório como somente leitura e, se os arquivos existirem, exporta `GITHUB_ACTOR`, `GITHUB_TOKEN` e `GITHUB_CLONE_TOKEN` antes de iniciar o runner; assim o valor não depende de editar o `.env` versionado/sincronizado.
- Caso prefira outro caminho no host, defina `GITHUB_PACKAGES_TOKEN_HOST_DIR` no `.env` operacional apontando para a pasta que contém esses dois arquivos.

### Armazenamento do token da Pepper para a sandbox

- Para chamadas à API da Pepper executadas pelo modelo, guarde o token fora do repositório em `/root/infra/pepper-token/pepper_api_token`.
- O `sandbox-orchestrator` monta esse diretório como somente leitura em `/run/secrets/pepper-token`; se o arquivo existir, o conteúdo é exportado como `PEPPER_API_TOKEN` e `PEPPER_AUTHORIZATION="Bearer $PEPPER_API_TOKEN"` antes de iniciar o runner.
- Caso prefira outro caminho no host, defina `PEPPER_TOKEN_HOST_DIR` no `.env` operacional apontando para a pasta que contém `pepper_api_token`.

### MCP Server para comandos no host

- O serviço Java `mcp-server` publica o healthcheck em `GET /mcp`, exposto pelo Caddy em `https://iahub.xyz/mcp`.
- A tool `POST /mcp/tools/linux-command` aceita body `{ "command": "<comando>" }`.
- Quando `MCP_SERVER_API_TOKEN` estiver definido no `.env` operacional, a tool exige `Authorization: Bearer <MCP_SERVER_API_TOKEN>`. Sem essa variável, mantém compatibilidade com o contrato operacional simples usado pelo Tihub.
- O container monta `/var/run/docker.sock` e a raiz do host em `/host:ro`, permitindo validar arquivos e consultar logs com comandos como `docker logs --tail 200 ai-hub-6-backend-1`.
- Os limites operacionais são controlados por `MCP_SERVER_COMMAND_TIMEOUT_SECONDS` e `MCP_SERVER_MAX_OUTPUT_CHARS`.

## Testes

- Backend: `mvn -f apps/backend test`
- MCP Server: `mvn -f apps/mcp-server test`
- Frontend: `npm --prefix apps/frontend run lint`
- Sandbox Orchestrator: `npm --prefix apps/sandbox-orchestrator test`

### Expondo o frontend via HTTP

Para disponibilizar a interface web publicamente (sem TLS, usando apenas HTTP) ajuste o arquivo `.env` e recrie os contêineres:

1. Defina `FRONTEND_HTTP_PORT=80` (ou outra porta pública exposta).
2. Configure `HUB_ALLOWED_ORIGINS` com a origem pública do frontend (ex.: `http://seu.dominio.com`).
3. Mantenha `VITE_API_BASE_URL=/api` — o nginx do container do frontend roteia as chamadas para o serviço `backend`.
4. Ajuste `HUB_CORS_ALLOW_CREDENTIALS` para `true` apenas se precisar encaminhar cookies/autenticação cruzada.

> No AWS Lightsail, replique esses valores em `infra/lightsail/containers.example.json` (`HUB_ALLOWED_ORIGINS` e `VITE_API_BASE_URL=/api`) antes de publicar o serviço.

## Deploy em produção

- As imagens publicadas na pipeline ficam disponíveis em `ghcr.io/<owner>/ai-hub-6-backend`, `ghcr.io/<owner>/ai-hub-6-frontend`, `ghcr.io/<owner>/ai-hub-6-sandbox`, `ghcr.io/<owner>/ai-hub-6-caddy` e `ghcr.io/<owner>/ai-hub-6-mcp-server`.
- Para que o deploy automático funcione, crie os secrets `GHCR_USERNAME` e `GHCR_TOKEN` (um PAT com escopo `read:packages`) no repositório — eles serão usados para executar `docker login` na VPS antes de `docker compose pull`.
- Utilize o exemplo `infra/lightsail/containers.example.json` para provisionar o serviço no AWS Lightsail Container Service.
- Em uma VPS genérica (como Locaweb), execute `sudo ./infra/setup_vps.sh` para instalar dependências, gerar `.env` com as credenciais do MySQL 5.7 hospedado em `d555d.vps-kinghost.net` e subir os contêineres via Docker Compose.

- **IMPORTANTE:** use o mesmo owner em todo o fluxo (build/push e deploy/pull). Se `GHCR_USERNAME` divergir de `github.repository_owner`, o ambiente pode subir imagens de owners diferentes (por exemplo `paulodb` e `outro-owner`).

## CI/CD

O workflow `ci.yml` executa testes do backend, lint do frontend e validação de Dockerfiles a cada push ou pull request.

## Licença

MIT
