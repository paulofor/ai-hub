# AI Hub

AI Hub é um monorepo full-stack que centraliza a criação e governança de sistemas a partir de blueprints controlados exclusivamente via interface web. O projeto combina um backend Spring Boot com um frontend React/Vite, infraestrutura pronta para Docker e AWS Lightsail, além de automações GitHub Actions.

## Visão geral

- **UI-first**: nenhuma ação destrutiva é executada sem confirmação explícita na UI.
- **Integrações GitHub**: criação de repositórios, disparo de workflows, análise de logs, comentários e PRs de correção.
- **OpenAI Responses API**: geração estruturada de relatórios `CiFix` a partir de falhas em pipelines.
- **Persistência**: MySQL 5.7 (produção) com Flyway para auditoria, blueprints, projetos, prompts e respostas.

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

1. Ajuste as variáveis em `.env` na raiz (já versionado com valores padrão compatíveis com a VPS) e, se necessário, personalize também `apps/backend/.env.example` e `apps/frontend/.env.example`. O campo `DB_PASS` já está configurado com a senha atual (`S3nh@Fort3!`); se a senha for rotacionada, atualize o valor nesses arquivos antes de reiniciar os contêineres.
2. Garanta que você tenha um MySQL acessível (pode reutilizar o mesmo da produção ou apontar para outro ambiente) e então execute `docker-compose up --build` para subir backend e frontend.
3. A UI estará disponível em `http://localhost:5173` e a API em `http://localhost:8080`.

## Testes

- Backend: `mvn -f apps/backend test`
- Frontend: `npm --prefix apps/frontend run lint`

## Deploy em produção

- Construa as imagens usando os Dockerfiles dedicados em `apps/backend` e `apps/frontend`.
- Utilize o exemplo `infra/lightsail/containers.example.json` para provisionar o serviço no AWS Lightsail Container Service.
- Em uma VPS genérica (como Locaweb), execute `sudo ./infra/setup_vps.sh` para instalar dependências, gerar `.env` com as credenciais do MySQL 5.7 hospedado em `d555d.vps-kinghost.net` e subir os contêineres via Docker Compose.

## CI/CD

O workflow `ci.yml` executa testes do backend, lint do frontend e validação de Dockerfiles a cada push ou pull request.

## Licença

MIT
