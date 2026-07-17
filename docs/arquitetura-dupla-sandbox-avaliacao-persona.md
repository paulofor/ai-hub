# Solicitação com construção e avaliação por persona

## Resposta curta

Sim. O AI Hub pode oferecer uma solicitação composta em que um agente constrói um produto digital e um segundo agente avalia o resultado segundo uma persona do público-alvo. A recomendação é usar **duas execuções isoladas**, e não dar acesso de escrita ao mesmo sandbox para ambos os agentes.

O agente construtor trabalha no sandbox de escrita. Ao finalizar cada ciclo, o orquestrador entrega ao avaliador uma cópia imutável do workspace, o diff, a URL de preview (quando disponível) e as evidências de teste. O avaliador roda em sandbox de leitura e devolve feedback estruturado. Esse feedback se torna a entrada do próximo ciclo do construtor.

## Por que duas sandboxes em vez de uma compartilhada

Dois modelos no mesmo diretório, com permissão de escrita, podem alterar ou apagar o trabalho um do outro, observar arquivos em estado parcial e produzir um feedback que não corresponde à versão que será corrigida. Isso prejudica a rastreabilidade e pode criar conflitos difíceis de reproduzir.

Uma cópia de leitura para a persona resolve esses problemas:

- cada avaliação aponta para um `iteration` e um `git commit`/snapshot específico;
- a persona não consegue modificar código, credenciais ou artefatos do construtor;
- o construtor recebe feedback explícito e versionado, em vez de inferir alterações feitas por outro agente;
- falhas, custos e transcrições ficam separados por papel.

Um único sandbox só é aceitável se a persona tiver ferramentas estritamente de leitura e o orquestrador bloquear a execução dela até o construtor publicar um snapshot. Ainda assim, duas pastas/sandboxes lógicos tornam a implementação e a auditoria mais seguras.

## Fluxo proposto

1. O usuário seleciona o tipo **Construir e validar com persona**, o modelo do construtor, o modelo do avaliador, a descrição do produto, a persona e o número máximo de ciclos.
2. O orquestrador cria o sandbox do construtor com `workspace-write` e executa a primeira implementação.
3. Depois de testes e geração do diff, o orquestrador cria um snapshot imutável e inicia o sandbox do avaliador com `read-only`.
4. O avaliador inspeciona o preview, o código e as evidências permitidas e responde somente com um relatório JSON validado.
5. Se houver itens priorizados e ainda restarem ciclos, o orquestrador envia o relatório ao construtor e inicia uma nova iteração.
6. Ao encerrar, a solicitação exibe o produto/diff final, os relatórios por iteração, testes, custos de ambos os papéis e a justificativa de parada.

O fluxo é sequencial por ciclo: construtor → avaliador → construtor. Não é recomendável deixá-los conversar livremente em paralelo, pois isso aumenta custo e não fornece uma versão estável para validar.

## Contrato de dados mínimo

O pedido composto pode introduzir um perfil, por exemplo `PRODUCT_PERSONA_REVIEW`, com esta configuração:

```json
{
  "builderModel": "gpt-5-codex",
  "reviewerModel": "gpt-5",
  "persona": {
    "name": "Marina, dona de pequena loja",
    "goals": ["cadastrar produtos rapidamente", "entender vendas do dia"],
    "context": "usa celular, tem pouco tempo e pouca familiaridade técnica",
    "accessibilityNeeds": ["texto claro", "alto contraste"]
  },
  "maxIterations": 3,
  "acceptanceCriteria": ["fluxo principal utilizável", "build e testes passam"]
}
```

O retorno de cada avaliação deve ser schema-validado, para evitar que texto livre seja interpretado como instrução executável pelo construtor:

```json
{
  "iteration": 1,
  "verdict": "NEEDS_CHANGES",
  "liked": ["..."],
  "issues": [{ "severity": "HIGH", "journey": "Cadastrar produto", "evidence": "...", "recommendation": "..." }],
  "mustFixNext": ["..."],
  "stopReason": null
}
```

`severity` deve ser limitado a `BLOCKER`, `HIGH`, `MEDIUM` e `LOW`; o próximo prompt do construtor deve incluir somente os itens validados e a referência do snapshot avaliado.

## Limites de segurança e operação

- O construtor recebe apenas as permissões necessárias ao repositório; o avaliador não recebe token de Git, token de deploy, senha de banco ou credenciais do construtor.
- O avaliador deve operar em `read-only`. Para testar uma interface, ele pode acessar uma URL de preview temporária, com allowlist e expiração.
- A solicitação precisa de limites de iterações, tokens, duração e custo por papel. Pare também quando não houver itens `HIGH`/`BLOCKER`, quando os critérios forem atendidos ou quando a avaliação repetir o mesmo feedback.
- A saída da persona é insumo de produto, não aprovação humana automática. PR, deploy e publicação continuam dependentes das regras existentes e, quando aplicável, da aprovação humana.
- Registre snapshots, prompts, modelo, versão, relatório e testes por ciclo para permitir auditoria e reprodução.

## Caminho de implementação no AI Hub

1. Adicionar o novo perfil e os campos de configuração no backend e na tela de solicitação.
2. Estender o `SandboxJob` com uma configuração de revisão e uma lista de iterações; cada item deve guardar os IDs dos dois sandboxes, snapshot, feedback, testes, consumo e status.
3. No `SandboxJobProcessor`, separar o loop atual em duas rotinas: uma de construção com escrita e outra de avaliação sem ferramentas de escrita.
4. Acrescentar validação de schema para a resposta do avaliador e converter o feedback validado em contexto explícito da próxima rodada do construtor.
5. Exibir uma linha do tempo no frontend, com relatórios de "o que gostou" e "o que não gostou", evidências e a versão correspondente.
6. Cobrir o orquestrador com testes de isolamento de permissões, limite de ciclos, rejeição de JSON inválido, ausência de feedback repetido e parada após critérios de aceite.

Esse desenho permite usar modelos diferentes (por exemplo, um especializado em codificação e outro com instruções de pesquisa/UX) ou o mesmo modelo com prompts e permissões diferentes. A diferenciação do papel, dos dados de entrada e das ferramentas é mais importante que usar dois nomes de modelo distintos.
