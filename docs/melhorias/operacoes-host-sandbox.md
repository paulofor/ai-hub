# Melhoria futura — operações controladas no host para sandboxes Codex

## Contexto

Na solicitação **#739**, o modelo conseguiu implementar e validar a alteração da tela `http://191.252.181.168:5173/mois/sales-pages-library/286`, mas não conseguiu publicar a mudança na porta original `5173`.

A causa operacional foi que a porta `5173` estava servida por um container `marketinghub-frontend`/nginx. Para a alteração aparecer nessa URL, seria necessário rebuildar ou recriar esse container. A sessão de sandbox usada pelo modelo não tinha Docker daemon disponível, então a validação precisou ser desviada para um Vite dev server em `5174`.

Este documento registra uma **melhoria para o futuro**. A proposta abaixo **não deve ser implementada agora** sem planejamento, revisão de segurança e definição de escopo operacional.

## Problema observado na #739

O modelo tinha capacidade para:

- editar o código do repositório;
- executar validações locais, como typecheck/build;
- subir um servidor de desenvolvimento alternativo;
- explicar o bloqueio encontrado.

O modelo não tinha capacidade segura para:

- consultar o estado real do container que publicava `5173`;
- executar rebuild/recreate do serviço frontend no host;
- validar a publicação final na URL original após recriar o container;
- coletar logs do serviço real sem depender de acesso Docker direto na sandbox.

## Melhoria proposta

Criar futuramente uma ferramenta de alto nível, por exemplo `host-operation`, para permitir que o modelo solicite operações controladas no host quando uma tarefa exigir interação com serviços reais.

A ferramenta deve reaproveitar o MCP Server existente como executor operacional, mas não deve expor Docker bruto para o modelo. Em vez disso, o modelo chamaria operações semânticas e allowlistadas, como:

- `status` de um serviço;
- `logs` com limite de linhas;
- `healthcheck` de uma URL;
- `recreate` de um serviço específico;
- `rollback` quando houver estratégia definida.

Exemplo conceitual de payload:

```json
{
  "project": "marketing-hub",
  "service": "frontend",
  "operation": "recreate",
  "reason": "Publicar alteração validada da solicitação #739 na porta 5173"
}
```

## Guardrails necessários

Antes de qualquer implementação, a melhoria deve prever:

- allowlist de projetos, serviços e operações;
- mapeamento fixo entre operação semântica e comando real;
- auditoria por usuário, request, job, serviço, comando e resultado;
- timeout e limite de frequência por operação;
- modo `dry-run` para operações destrutivas;
- mascaramento de segredos em logs e variáveis de ambiente;
- confirmação explícita quando a operação afetar produção;
- healthcheck automático após recreate/deploy;
- estratégia de rollback documentada por serviço.

## Decisão atual

Não implementar Docker-in-Docker completo na sandbox como resposta imediata ao problema da #739.

A decisão registrada é apenas manter esta proposta como item de melhoria futura. Quando o tema for priorizado, a implementação deve ser desenhada como uma camada operacional controlada, auditável e restrita, preferencialmente sobre o MCP Server, em vez de fornecer acesso direto ao Docker daemon dentro da sandbox.
