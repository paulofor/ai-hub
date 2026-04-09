# Esquema de implantação de compaction para agente de código

## Objetivo

Reduzir o crescimento contínuo de tokens de entrada em uma aplicação que conversa com um modelo de código da OpenAI, preservando contexto útil e controlando **custo**, **latência** e **qualidade**.

Este plano foi pensado para uma aplicação que mantém histórico multi-turn e usa sandbox/ferramentas durante o fluxo.

---

## Resumo executivo

A OpenAI recomenda o uso da **Responses API** para novos projetos e oferece suporte nativo a **conversation state** e **compaction**. Na prática, compaction serve para reduzir o contexto enviado ao modelo sem perder o estado necessário para continuar a tarefa.

Para o seu caso, a recomendação inicial é:

- manter em bruto apenas as **últimas 10 interações completas**;
- começar a compactar quando o **input renderizado** passar de **10k a 12k tokens**;
- tratar **20k tokens de entrada** como um teto operacional forte para forçar compactação antes da próxima chamada;
- guardar fora da conversa um **estado estruturado da sessão**;
- usar **prompt caching** a favor, deixando instruções estáticas e ferramentas sempre no início do prompt.

> Observação: os valores de 10k–12k e 20k aqui são **heurísticas de implantação**, não limites oficiais da OpenAI.

---

## Base da decisão

A OpenAI documenta que:

- a **janela de contexto** inclui **input, output e reasoning tokens**;
- a **Responses API** é recomendada para novos projetos;
- o **server-side compaction** pode ser ativado por limiar de tokens renderizados;
- compaction ajuda agentes de longa duração a manter mais passos sem degradação por contexto longo;
- **prompt caching** reduz custo e latência para prefixos repetidos.

No seu relatório, o crescimento de entrada ocorreu cedo:

- ~8k tokens: interação **22**
- ~10k tokens: interação **23**
- ~12k tokens: interação **25**
- ~15k tokens: interação **30**
- ~20k tokens: interação **38**

Isso sugere que a aplicação está acumulando histórico mais rápido do que o necessário.

---

## Estratégia recomendada

## 1. Estrutura de contexto em 3 camadas

### Camada A — prefixo estável
Conteúdo que deve permanecer quase idêntico entre chamadas:

- instrução principal do agente;
- regras fixas da aplicação;
- descrição das ferramentas;
- contratos de saída;
- convenções do repositório/projeto.

**Objetivo:** maximizar reaproveitamento por prompt caching.

### Camada B — estado operacional compacto
Resumo persistente da sessão, atualizado a cada interação relevante.

Campos recomendados:

```json
{
  "objetivo_atual": "...",
  "subtarefas_abertas": ["..."],
  "decisoes_tomadas": ["..."],
  "arquivos_modificados": ["..."],
  "erros_ativos": ["..."],
  "hipoteses_em_teste": ["..."],
  "comandos_executados": ["..."],
  "resultado_mais_recente": "...",
  "proximo_passo_sugerido": "..."
}
```

### Camada C — janela deslizante recente
Manter apenas as interações mais recentes em bruto:

- padrão inicial: **10 interações completas**;
- mínimo aceitável: **8**;
- máximo temporário: **12**, quando a tarefa depender muito de continuidade local.

---

## 2. Regras de corte

Use **tokens**, não apenas contagem de mensagens.

### Regra principal
Acione compaction quando ocorrer qualquer uma destas condições:

1. `rendered_input_tokens >= 10000`
2. `interacoes_brutas > 10`
3. `estimated_total_context >= 70%` da janela operacional definida internamente

### Regra forte
Forçar compactação antes da próxima chamada quando:

1. `rendered_input_tokens >= 12000` em fluxo comum
2. `rendered_input_tokens >= 20000` em qualquer cenário
3. houver forte repetição de histórico sem ganho claro de qualidade

### Regra de exceção
Permita segurar mais contexto bruto apenas quando:

- o modelo acabou de editar vários arquivos correlacionados;
- a próxima ação depende de detalhes textuais exatos das últimas respostas;
- a aplicação está em fase curta de depuração iterativa de alta dependência local.

Mesmo nessas exceções, faça corte assim que o loop crítico terminar.

---

## 3. Política operacional sugerida

### Política padrão

- **Últimas 10 interações:** manter em bruto
- **Resumo operacional:** sempre anexado
- **Disparo suave:** 10k tokens de entrada
- **Disparo obrigatório:** 12k tokens de entrada
- **Teto duro:** 20k tokens de entrada

### Política para sessões muito longas

Quando a sessão ultrapassar 30 a 40 interações totais:

- reduzir janela bruta para **8 interações**;
- aumentar a qualidade do resumo operacional;
- separar memória por tópico ou tarefa, em vez de manter tudo no mesmo encadeamento.

---

## 4. Fluxo de implantação

### Fluxo A — usando Responses API com compaction nativo

**Recomendado para novos projetos.**

1. Migrar as chamadas principais para `responses.create`
2. Habilitar `store: true` se quiser estado mantido entre turnos
3. Configurar `context_management` com `compact_threshold`
4. Continuar mantendo um resumo operacional externo, mesmo com compaction nativo
5. Registrar métricas por chamada

### Exemplo conceitual

```json
{
  "model": "gpt-5.4",
  "store": true,
  "input": "...",
  "context_management": {
    "compact_threshold": 10000
  }
}
```

> Ajuste o valor do `compact_threshold` após observar 1 a 2 semanas de produção.

### Fluxo B — mantendo Chat Completions ou compaction manual

Se você ainda não migrar para Responses API:

1. medir tokens antes de cada envio;
2. se passar do limiar, gerar um resumo operacional do histórico antigo;
3. substituir mensagens antigas pelo resumo;
4. manter só a janela recente em bruto;
5. continuar a chamada ao modelo.

---

## 5. Algoritmo recomendado

```text
A cada nova interação:

1. Atualizar estado estruturado da sessão
2. Medir tokens do contexto que seria enviado
3. Se tokens < 10k e janela <= 10 interações:
      enviar normalmente
4. Se tokens >= 10k OU janela > 10 interações:
      compactar histórico antigo
      preservar últimas 10 interações
      anexar resumo operacional
5. Se tokens >= 12k após compactação:
      reduzir janela para 8 interações
      simplificar contexto redundante
6. Se tokens >= 20k:
      bloquear envio bruto
      forçar recompacção antes de chamar o modelo
7. Registrar métricas de custo, latência e qualidade
```

---

## 6. Formato do resumo operacional

O resumo não deve ser narrativo demais. Ele deve ser **operacional**, curto e acionável.

### Modelo de resumo

```md
## Estado atual
- Objetivo: ...
- Status: ...

## O que já foi decidido
- ...
- ...

## Arquivos alterados
- ...
- ...

## Problemas em aberto
- ...
- ...

## Próximo passo
- ...
```

### Boas práticas

- remover trechos redundantes;
- preservar nomes de arquivos, funções, classes e erros;
- manter decisões arquiteturais;
- descartar explicações longas já resolvidas;
- evitar copiar logs brutos inteiros para o resumo.

---

## 7. Pseudocódigo de referência

```ts
interface SessionState {
  goal: string;
  openTasks: string[];
  decisions: string[];
  modifiedFiles: string[];
  activeErrors: string[];
  recentCommands: string[];
  latestOutcome: string;
  nextStep: string;
}

interface Turn {
  role: "user" | "assistant" | "tool";
  content: string;
}

const SOFT_TOKEN_THRESHOLD = 10_000;
const HARD_TOKEN_THRESHOLD = 12_000;
const ABSOLUTE_TOKEN_CEILING = 20_000;
const DEFAULT_RAW_WINDOW = 10;
const REDUCED_RAW_WINDOW = 8;

async function buildContext(params: {
  stablePrefix: Turn[];
  rawTurns: Turn[];
  sessionState: SessionState;
  countInputTokens: (turns: Turn[]) => Promise<number>;
}) {
  const { stablePrefix, rawTurns, sessionState, countInputTokens } = params;

  let rawWindow = rawTurns.slice(-DEFAULT_RAW_WINDOW);
  let context = [
    ...stablePrefix,
    {
      role: "assistant",
      content: renderOperationalSummary(sessionState),
    },
    ...rawWindow,
  ];

  let inputTokens = await countInputTokens(context);

  if (inputTokens >= SOFT_TOKEN_THRESHOLD || rawTurns.length > DEFAULT_RAW_WINDOW) {
    context = [
      ...stablePrefix,
      {
        role: "assistant",
        content: renderOperationalSummary(sessionState),
      },
      ...rawTurns.slice(-DEFAULT_RAW_WINDOW),
    ];

    inputTokens = await countInputTokens(context);
  }

  if (inputTokens >= HARD_TOKEN_THRESHOLD) {
    context = [
      ...stablePrefix,
      {
        role: "assistant",
        content: renderOperationalSummary(sessionState),
      },
      ...rawTurns.slice(-REDUCED_RAW_WINDOW),
    ];

    inputTokens = await countInputTokens(context);
  }

  if (inputTokens >= ABSOLUTE_TOKEN_CEILING) {
    throw new Error("Contexto acima do teto operacional. Recompactar antes de enviar.");
  }

  return { context, inputTokens };
}

function renderOperationalSummary(state: SessionState): string {
  return [
    "## Estado atual",
    `- Objetivo: ${state.goal}`,
    `- Resultado mais recente: ${state.latestOutcome}`,
    "",
    "## Decisões tomadas",
    ...state.decisions.map(item => `- ${item}`),
    "",
    "## Arquivos modificados",
    ...state.modifiedFiles.map(item => `- ${item}`),
    "",
    "## Problemas em aberto",
    ...state.activeErrors.map(item => `- ${item}`),
    "",
    "## Próximo passo",
    `- ${state.nextStep}`,
  ].join("\n");
}
```

---

## 8. Instrumentação mínima

Registre por chamada:

- `input_tokens`
- `output_tokens`
- `cached_input_tokens` quando disponível
- `reasoning_tokens` quando disponível no produto/telemetria adotados
- `latency_ms`
- `cost_estimate`
- `raw_turn_count`
- `summary_size_tokens`
- `compaction_triggered` (true/false)
- `compaction_mode` (`native`, `manual`, `none`)

### KPIs esperados após implantação

- queda do crescimento linear do input;
- redução da latência média;
- menor custo por interação longa;
- menor frequência de estouro de contexto;
- estabilidade melhor em sessões acima de 20 interações.

---

## 9. Plano de rollout

### Fase 1 — observabilidade
- medir tokens antes de enviar;
- registrar custo e latência;
- ativar dashboard por sessão.

### Fase 2 — janela deslizante
- manter apenas últimas 10 interações;
- adicionar resumo operacional externo.

### Fase 3 — limiar automático
- disparar compaction a partir de 10k tokens;
- forçar recompacção acima de 12k.

### Fase 4 — Responses API
- migrar chamadas principais para Responses API;
- habilitar compaction nativo por limiar.

### Fase 5 — tuning fino
- comparar qualidade com 8, 10 e 12 interações brutas;
- ajustar tamanho do resumo;
- revisar casos de exceção.

---

## 10. Decisão inicial recomendada para a sua aplicação

Se fosse para implantar amanhã, eu começaria assim:

- **Modelo principal:** GPT-5.4 ou o modelo de código escolhido na sua stack
- **API:** Responses API
- **Janela bruta:** 10 interações
- **Resumo operacional:** obrigatório em toda chamada após a interação 10
- **Disparo de compaction:** 10k tokens
- **Disparo obrigatório:** 12k tokens
- **Teto duro:** 20k tokens
- **Fallback:** reduzir para 8 interações em tarefas muito longas
- **Revisão após produção:** 7 a 14 dias

---

## 11. O que não fazer

- não manter o histórico inteiro em bruto indefinidamente;
- não usar apenas “número de mensagens” como métrica de corte;
- não resumir demais a ponto de apagar decisões técnicas importantes;
- não colocar logs extensos e repetitivos no contexto principal;
- não alterar o prefixo estável a cada chamada, para não desperdiçar prompt caching.

---

## 12. Referências

- OpenAI — Responses API: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI — Conversation state: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI — Compaction: https://developers.openai.com/api/docs/guides/compaction
- OpenAI — Compact a response (API reference): https://developers.openai.com/api/reference/resources/responses/methods/compact/
- OpenAI — Prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI Cookbook — Codex Prompting Guide: https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide
- OpenAI — Compare models: https://developers.openai.com/api/docs/models/compare

