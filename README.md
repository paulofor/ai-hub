# AI Hub

AI Hub é um monorepo full-stack que centraliza a criação e governança de sistemas a partir de blueprints controlados exclusivamente via interface web. O projeto combina um backend Spring Boot com um frontend React/Vite, infraestrutura pronta para Docker e AWS Lightsail, além de automações GitHub Actions.

## Visão geral

- **UI-first**: nenhuma ação destrutiva é executada sem confirmação explícita na UI.
- **Integrações GitHub**: criação de repositórios, disparo de workflows, análise de logs, comentários e PRs de correção.
- **OpenAI Responses API**: geração estruturada de relatórios `CiFix` a partir de falhas em pipelines.
- **Persistência**: PostgreSQL com Flyway para auditoria, blueprints, projetos, prompts e respostas.

## Estrutura de pastas

```
apps/
  backend/
  frontend/
infra/
  nginx/
  lightsail/
.github/
  workflows/
```

## Desenvolvimento local

1. Copie `.env.example` para `.env` na raiz, em `apps/backend` e `apps/frontend` e ajuste variáveis.
2. Execute `docker-compose up --build` para subir PostgreSQL, backend e frontend.
3. A UI estará disponível em `http://localhost:5173` e a API em `http://localhost:8080`.

## Testes

- Backend: `mvn -f apps/backend test`
- Frontend: `npm --prefix apps/frontend run lint`

## Deploy em produção

- Construa as imagens usando os Dockerfiles dedicados em `apps/backend` e `apps/frontend`.
- Utilize o exemplo `infra/lightsail/containers.example.json` para provisionar o serviço no AWS Lightsail Container Service.

## CI/CD

O workflow `ci.yml` executa testes do backend, lint do frontend e validação de Dockerfiles a cada push ou pull request.

## Licença

MIT
