# Proposta: medir e controlar a memória da suíte do Marketing Hub

> **Estado no AI Hub:** a orientação operacional desta proposta foi incorporada à instrução
> obrigatória enviada ao modelo nos fluxos Codex App Server e Responses API. Os scripts específicos
> do Marketing Hub continuam sendo uma implementação a realizar naquele repositório quando uma
> tarefa de código o disponibilizar na sandbox.

## Contexto e causa a confirmar

A solicitação Codex **#2369** registrou que a homologação do Marketing Hub ocorre dentro do
`sandbox-orchestrator`, hoje contido em **8 GiB**, e que uma JVM de testes pode reservar até
**3 GiB**. O histórico do AI Hub também comprova que processos Java já foram encerrados por OOM.

Antes de ajustar o limite, a pergunta obrigatória é: **por que esse erro aconteceu?** A evidência
disponível demonstra concorrência por memória no mesmo cgroup, mas ainda não distingue entre:

1. heap legítimo de uma classe de testes;
2. contextos Spring diferentes ou retidos;
3. forks Maven concorrentes;
4. processos filhos que continuam vivos;
5. soma da JVM com Codex App Server, Node, navegador e Docker.

Portanto, aumentar RAM isoladamente trataria o sintoma. A implementação deve primeiro produzir
uma linha de base reproduzível e atribuir o pico ao grupo e processo responsável.

## Implementação proposta no repositório Marketing Hub

### 1. Inventário determinístico

Criar `scripts/test-memory/inventory.sh` para listar, sem executar testes:

- testes unitários;
- testes de camada (`@WebMvcTest`, `@DataJpaTest` etc.);
- testes `@SpringBootTest` agrupados pela assinatura do contexto;
- usos de `@DirtiesContext`, com destaque para `BEFORE_EACH_TEST_METHOD` e
  `AFTER_EACH_TEST_METHOD`;
- configurações que alteram a chave de cache do Spring, como `@MockBean`, `@ActiveProfiles`,
  `@TestPropertySource` e propriedades em `@SpringBootTest`.

O inventário deve ser persistido como artefato JSON. Contar somente anotações não basta: duas
classes com configurações distintas podem criar dois contextos completos.

### 2. Runner sequencial e limitado

Adicionar perfis Maven ou tags JUnit estáveis para quatro grupos iniciais:

1. `unit`;
2. `slice`;
3. `spring-context`;
4. `integration`.

Executá-los em **processos Maven separados e sequenciais**. Cada processo termina antes do
seguinte, liberando heap e contextos. A configuração inicial recomendada é:

```xml
<forkCount>1</forkCount>
<reuseForks>false</reuseForks>
<argLine>
  -Xms256m -Xmx2048m
  -XX:+HeapDumpOnOutOfMemoryError
  -XX:HeapDumpPath=${project.build.directory}/memory/heap-%p.hprof
  -Xlog:gc*,safepoint:file=${project.build.directory}/memory/gc-%p.log:time,uptime,level,tags
</argLine>
```

`reuseForks=false` sacrifica tempo para isolar a primeira medição. Depois da identificação da
causa, ele pode ser reavaliado por grupo; não deve virar uma regra permanente sem comparar duração
e pico.

O comando de cada grupo deve usar `MAVEN_OPTS=-Xmx512m` para limitar a JVM do próprio Maven,
enquanto `argLine` limita a JVM forkada pelo Surefire/Failsafe. Configurar apenas um deles deixa a
outra JVM sem o controle pretendido.

### 3. Medir o cgroup e a árvore de processos

Criar `scripts/test-memory/run-group.sh <grupo>` para:

1. capturar `memory.current`, `memory.peak`, `memory.events` e `memory.stat` do cgroup v2 antes e
   depois do grupo;
2. amostrar a cada segundo PID, PPID, RSS, comando e elapsed time da árvore Maven/Java;
3. executar `/usr/bin/time -v` quando disponível;
4. registrar exit code, duração e relatórios Surefire;
5. copiar somente em falha os heap dumps, logs de GC e `hs_err_pid*.log`;
6. emitir `target/test-memory/<grupo>/summary.json` e um resumo Markdown.

O valor principal é `memory.peak` do cgroup, pois RSS de um único Java não captura browsers,
Node, filhos, page cache e demais processos concorrentes. A amostragem por PID serve para atribuir
esse total.

Para evitar confundir o consumo fixo do Codex App Server com o da suíte, o relatório deve registrar
o **baseline imediatamente anterior** e apresentar `pico incremental = memory.peak do grupo -
baseline`.

### 4. Diagnóstico dos contextos Spring

Na fase de medição, habilitar estatísticas do cache de contextos:

```properties
logging.level.org.springframework.test.context.cache=DEBUG
```

O parser do relatório deve extrair `hitCount`, `missCount`, tamanho e evicções. Classes com muitos
misses ou que usam `@DirtiesContext` entram no ranking de investigação.

A correção deve seguir esta ordem:

1. remover `@SpringBootTest` quando um teste unitário ou de camada cobrir o mesmo contrato;
2. padronizar profiles, properties e mocks para maximizar reuso seguro do contexto;
3. substituir `@DirtiesContext` por limpeza explícita do estado mutável;
4. se isolamento completo for necessário, colocar essa classe em grupo/processo próprio;
5. reduzir `Xmx` somente depois de confirmar que o GC não causa thrashing.

O heap dump é evidência de exceção, não artefato padrão: ele pode conter dados sensíveis,
deve ter retenção curta e nunca ser publicado em logs ou artefatos públicos.

### 5. Integração no CI e na homologação local

Criar dois modos:

- `test-memory-baseline`: executa os quatro grupos sequenciais, sempre publica os resumos pequenos
  e publica diagnósticos pesados somente em falha;
- `test-memory-compare`: compara com baseline versionada e falha por regressão significativa.

Na primeira semana, o gate deve ser informativo para obter distribuição real. Depois, adotar:

- nenhuma ocorrência nova em `oom`, `oom_kill` ou `max` de `memory.events`;
- suíte integral aprovada sem omitir testes;
- execução estritamente sequencial;
- pico total abaixo de **75%** do limite efetivo do cgroup;
- alerta de regressão quando o pico de um grupo crescer mais de 10% e 256 MiB sobre a mediana de
  pelo menos cinco execuções da mesma revisão de baseline.

Com o limite atual de 8 GiB, 75% equivalem a 6 GiB. Contudo, esse teto é do cgroup inteiro, e não
uma autorização para entregar 6 GiB ao Java. Se o baseline fixo já estiver alto, o orçamento do
teste precisa ser `6 GiB - baseline - margem operacional`.

## Fases de entrega

### Fase A — medir sem mudar comportamento

- inventário e agrupamento;
- runner e relatório;
- cinco execuções para formar baseline;
- gate apenas informativo.

### Fase B — corrigir a retenção comprovada

- atacar as classes no topo de misses/pico;
- comparar antes/depois por grupo;
- comprovar que a quantidade de testes e a cobertura não diminuíram.

### Fase C — tornar o orçamento obrigatório

- ativar gates de OOM, sequencialidade e regressão;
- documentar como reproduzir localmente;
- manter histórico pequeno de summaries, sem versionar heap dumps.

### Fase D — decidir sobre RAM

Somente depois das medições, considerar 12 GiB para o `sandbox-orchestrator`. Esse aumento exige
capacidade adicional real no host e preservação de RAM para Caddy, backend, MCP e sistema
operacional. Não se deve aumentar apenas `mem_limit` acima da capacidade física nem habilitar swap
como substituto de RAM.

## Critério de aceite

A implementação está concluída quando duas execuções integrais e consecutivas:

- executarem exatamente o mesmo conjunto esperado de testes;
- passarem todos os grupos, um por vez;
- produzirem summaries por grupo e ranking de contextos Spring;
- não incrementarem eventos de OOM;
- ficarem abaixo do orçamento calculado;
- deixarem diagnóstico suficiente para atribuir uma futura regressão a grupo e processo.
