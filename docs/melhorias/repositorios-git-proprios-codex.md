# Melhoria futura — repositórios Git próprios e provedores não GitHub para o Codex

## Contexto

O AI Hub hoje possui integração forte com GitHub para automações como clone, criação de Pull Request, comentários, análise de workflows e webhooks. Em paralelo, o `sandbox-orchestrator` já possui uma base mais genérica para execução: ele aceita uma `repoUrl` direta, prepara um workspace temporário e clona o repositório com `git clone` antes de iniciar o Codex App Server ou o fluxo via Responses API.

Este documento registra opções futuras para permitir que o AI Hub trabalhe também com repositórios fora do GitHub, incluindo GitLab, Gitea/Forgejo e repositórios Git próprios hospedados em uma VPS.

## Objetivo

Permitir que o usuário escolha onde hospedar o código-fonte que será analisado ou alterado pelo Codex, sem limitar a execução ao GitHub.

A melhoria deve separar claramente duas camadas:

1. **Git genérico**: clone, checkout, diff, commit local, patch e push.
2. **Plataforma de colaboração**: Pull Request, Merge Request, comentários, webhooks, pipelines, permissões e tokens específicos de cada provedor.

## Opção 1 — Repositório Git bare em VPS

### Descrição

Criar um repositório Git simples na VPS usando `git init --bare`, normalmente acessado via SSH:

```bash
sudo adduser git
sudo mkdir -p /srv/git/meu-projeto.git
sudo chown -R git:git /srv/git
sudo -u git git init --bare /srv/git/meu-projeto.git
```

Exemplo de remoto:

```bash
git remote add vps git@SEU_IP:/srv/git/meu-projeto.git
git push vps main
```

### Vantagens

- Baixa complexidade.
- Baixo custo operacional.
- Controle total do servidor.
- Funciona com Git puro.
- Suficiente para clone, push, branches e histórico.

### Limitações

- Não oferece interface web nativa.
- Não possui Pull Request/Merge Request.
- Não possui comentários em diff.
- Não possui permissões granulares por projeto sem configuração adicional.
- Não possui webhooks/CI/CD prontos.

### Uso recomendado

Boa opção para um primeiro passo quando o objetivo é apenas permitir que o Codex clone um repositório próprio, gere diffs e eventualmente faça push para uma branch.

## Opção 2 — Gitea ou Forgejo em VPS

### Descrição

Instalar uma plataforma leve de hospedagem Git na VPS, como Gitea ou Forgejo. Essas ferramentas oferecem uma experiência parecida com GitHub/GitLab, mas com operação mais simples e consumo menor de recursos.

### Vantagens

- Interface web para navegação do código.
- Pull Requests.
- Issues.
- Usuários, organizações e permissões.
- Tokens de acesso.
- Webhooks.
- Possibilidade de integração futura com runners/CI.
- Mais simples de manter que GitLab self-hosted.

### Limitações

- Exige backup, atualização e hardening da aplicação.
- A integração automática de PR/comentários no AI Hub exigiria cliente específico para a API do Gitea/Forgejo.
- Ainda é uma plataforma adicional para operar.

### Uso recomendado

É a opção mais equilibrada para hospedar repositórios próprios com uma experiência web semelhante à do GitHub, sem carregar a complexidade operacional do GitLab completo.

## Opção 3 — GitLab self-hosted em VPS

### Descrição

Instalar GitLab em infraestrutura própria para obter uma plataforma completa de repositórios, Merge Requests, CI/CD, permissões e webhooks.

### Vantagens

- Plataforma completa e madura.
- Merge Requests.
- CI/CD integrado.
- Webhooks e API robusta.
- Permissões avançadas.
- Registry e recursos corporativos, dependendo da edição/configuração.

### Limitações

- Maior consumo de memória, CPU e disco.
- Operação mais complexa.
- Upgrades e backups exigem mais cuidado.
- Pode ser excessivo se a necessidade principal for apenas hospedar repositórios para o Codex.

### Uso recomendado

Faz sentido quando já existe necessidade real de GitLab completo. Para uma VPS pequena ou para começar rápido, Gitea/Forgejo tende a ser mais simples.

## Opção 4 — Provedor Git genérico por `repoUrl`

### Descrição

Adicionar no AI Hub uma forma de cadastrar ambientes/repositórios usando uma URL Git explícita, por exemplo:

```text
ssh://git@vps.exemplo.com/srv/git/meu-projeto.git
https://git.exemplo.com/org/meu-projeto.git
git@git.exemplo.com:org/meu-projeto.git
```

Nesse modo, o AI Hub não assumiria GitHub. Ele apenas passaria a `repoUrl`, branch e credenciais de clone/push para o `sandbox-orchestrator`.

### Vantagens

- Reaproveita o fluxo de sandbox já existente.
- Suporta GitLab, Gitea/Forgejo, Git bare e outros servidores Git.
- Permite começar com clone/diff/patch antes de implementar APIs específicas de provedor.

### Limitações

- Criação automática de PR/MR depende do provedor.
- Comentários e webhooks também dependem do provedor.
- Requer modelo seguro para armazenar e injetar credenciais.

### Uso recomendado

Deve ser a primeira evolução técnica do AI Hub para remover o acoplamento obrigatório a `owner/repo` GitHub no caminho de execução do Codex.

## Opção 5 — Camada de provedores Git

### Descrição

Criar uma abstração de provedores no backend e no sandbox-orchestrator:

```text
github
gitlab
gitea
forgejo
generic
```

Cada provedor implementaria apenas os recursos que suporta:

- resolver URL de clone;
- preparar credenciais;
- criar branch remota;
- criar Pull Request ou Merge Request;
- comentar em PR/MR;
- receber e validar webhooks;
- consultar pipelines/logs.

### Vantagens

- Arquitetura extensível.
- Evita adaptar GitLab/Gitea para parecer GitHub.
- Permite suporte progressivo por capacidade.
- Facilita exibir na UI quais automações estão disponíveis por provedor.

### Limitações

- Exige refatoração maior.
- Exige testes por provedor.
- Exige padronizar credenciais, permissões e auditoria.

### Uso recomendado

Deve ser planejada como evolução de médio prazo, depois que o suporte básico por `repoUrl` estiver validado.

## Segurança e credenciais

Qualquer opção precisa considerar:

- preferir SSH deploy keys ou tokens com escopo mínimo;
- separar credenciais de clone, push e criação de PR/MR quando possível;
- nunca registrar tokens em logs;
- mascarar credenciais embutidas em URLs;
- auditar qual usuário solicitou cada operação;
- limitar quais hosts podem ser clonados pelo sandbox;
- bloquear redes privadas/metadata services quando aplicável;
- definir política de rotação de chaves;
- documentar backup e recuperação dos repositórios próprios.

## Ordem sugerida de implementação

1. **Documentar e validar manualmente um repositório Git bare em VPS** para entender o fluxo mínimo.
2. **Permitir cadastro de `repoUrl` no AI Hub** sem assumir GitHub.
3. **Adicionar credenciais genéricas de clone via SSH/token**, com mascaramento e auditoria.
4. **Executar Codex em modo clone/diff/patch** para repositórios genéricos, sem PR automático no primeiro momento.
5. **Adicionar push para branch remota** quando o provedor permitir.
6. **Implementar provedores específicos** começando pelo escolhido como prioridade, por exemplo Gitea/Forgejo ou GitLab.
7. **Implementar PR/MR, comentários e webhooks** por provedor.
8. **Adicionar CI/CD e análise de pipelines** apenas quando houver API e necessidade clara.

## Decisão recomendada

Para curto prazo, a melhor estratégia é suportar `repoUrl` genérica e Git bare/Gitea/Forgejo em VPS apenas para clone e geração de patch.

Para médio prazo, recomenda-se Gitea ou Forgejo como opção self-hosted principal, porque entrega interface web e Pull Requests com menor complexidade que GitLab.

Para longo prazo, o AI Hub deve ter uma camada de provedores Git, mantendo GitHub como provedor completo inicial e adicionando GitLab/Gitea/Forgejo conforme prioridade operacional.
