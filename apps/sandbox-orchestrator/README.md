# Sandbox Orchestrator

Serviço responsável por receber jobs do backend do AI Hub, preparar um sandbox temporário (clone do repositório) e orquestrar o loop de tool-calling com o modelo `gpt-5-codex` via Responses API.

## Scripts disponíveis

- `npm start`: inicia o servidor em modo de produção.
- `npm run dev`: inicia o servidor com `node --watch` (hot reload simples).
- `npm test`: executa a suíte de testes baseada em `node:test`.

### Endpoints

- `POST /jobs`: cria um job informando `jobId`, `repoUrl` ou `repoSlug`, `branch`, `taskDescription` e (opcionalmente) `testCommand`/`commit`. O serviço clona o repositório em um diretório temporário, expõe as tools `run_shell`, `read_file`, `write_file` e `http_get` ao modelo e inicia o loop de tool-calling. A tool `http_get` permite consultas HTTP públicas, bloqueando hosts locais/privados e truncando respostas grandes.
  Quando um `testCommand` é enviado, ele é executado automaticamente no final do job; se o comando retornar erro ou expirar, o job é marcado como `FAILED` e o patch não é enviado para PR.
- `GET /jobs/{id}`: retorna o status atualizado do job (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`), além de `logs`, resumo, arquivos alterados e patch gerado (`git diff`).

Jobs ficam armazenados em memória enquanto executam e são atualizados de forma assíncrona pelo `SandboxJobProcessor`.

## Variáveis de ambiente

### Gerais de execução

| Variável | Descrição | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP exposta pelo serviço | `8083` |
| `SANDBOX_SLUG_PREFIX` | Prefixo aplicado antes do slug original | *(vazio)* |
| `SANDBOX_SLUG_SUFFIX` | Sufixo aplicado após o slug original | `-sandbox` |
| `SANDBOX_IMAGE` | Imagem base utilizada para provisionar o contêiner/VM efêmero | `ghcr.io/ai-hub/sandbox:latest` |
| `SANDBOX_TTL_SECONDS` | Tempo de vida do sandbox antes de ser reciclado | `86400` |
| `SANDBOX_CPU_LIMIT` | Limite de CPU aplicado à sandbox provisionada | `1` |
| `SANDBOX_MEMORY_LIMIT` | Limite de memória aplicado à sandbox provisionada | `512m` |
| `SANDBOX_WORKDIR` | Diretório base no host onde os workspaces e clones são criados | diretório temporário do sistema |
| `SANDBOX_HOST` | Host exposto para alcançar o sandbox | `127.0.0.1` |
| `SANDBOX_BASE_PORT` | Porta base usada para simular a atribuição incremental de portas | `3000` |
| `PR_CREATE_RETRY_ATTEMPTS` | Número máximo de tentativas para abrir um PR antes de desistir | `3` |
| `PR_CREATE_RETRY_DELAY_MS` | Tempo base (ms) aguardado entre tentativas consecutivas de criação de PR | `1500` |
| `OPENAI_PROMPT_CACHE_RETENTION` | Valor enviado em `prompt_cache_retention` na Responses API para reaproveitar prefixos estáveis do prompt | `24h` |
| `OPENAI_PROMPT_CACHE_KEY_PREFIX` | Prefixo opcional de `prompt_cache_key` para aumentar hit rate de cache entre jobs semelhantes | `ai-hub` (interno) |
| `GITHUB_CLONE_TOKEN` | Token utilizado para todas as operações no GitHub (clone, push e criação de PR). Se ausente, o serviço tenta `GITHUB_TOKEN`, `GITHUB_PR_TOKEN` ou um token embutido em `repoUrl`. | *(vazio)* |
| `GITHUB_CLONE_USERNAME` | Usuário usado na URL autenticada (aplicado apenas se o token estiver presente) | `x-access-token` |
| `GITHUB_PR_TOKEN` | (Opcional) Fallback para `GITHUB_CLONE_TOKEN`/`GITHUB_TOKEN`; o token escolhido é reutilizado em todas as operações no GitHub. | *(vazio)* |

### Limites de contexto (`CONTEXT_*`)

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `CONTEXT_RECENT_MESSAGE_LIMIT` | Quantidade de mensagens recentes preservadas no contexto antes de resumir histórico. | `8` (mínimo efetivo: `4`) | Valor maior melhora continuidade, mas aumenta custo/tokens por turno. | `6` a `16` |
| `CONTEXT_SUMMARY_LINE_LIMIT` | Máximo de linhas no resumo consolidado de contexto. | `50` (mínimo efetivo: `20`) | Valores altos enriquecem contexto resumido, porém aumentam prompt base. | `30` a `100` |
| `CONTEXT_WORKING_SET_LIMIT` | Número de itens de “working set” mantidos para decisões rápidas entre turnos. | `6` (mínimo efetivo: `1`) | Mais itens reduzem perda de contexto local, mas ampliam carga de manutenção e tokenização. | `4` a `12` |
| `CONTEXT_WORKING_SET_ITEM_CHAR_LIMIT` | Limite de caracteres por item do working set. | `1200` | Limites altos preservam detalhes; limites baixos forçam síntese agressiva e podem perder precisão. | `600` a `2000` |
| `CONTEXT_PROMPT_GC_TOKEN_THRESHOLD` | Limiar aproximado de tokens para disparar “garbage collection”/compactação de prompt. | `24000` | Quanto menor, mais compactação (economia); quanto maior, mais contexto bruto e maior custo. | `16000` a `48000` |
| `CONTEXT_PROMPT_GC_TARGET_TOKENS` | Meta de tokens após compactação do prompt. | `min(16000, threshold - 2000)` com teto efetivo `< threshold` | Meta menor reduz custo e risco de overflow; meta alta preserva contexto com maior consumo. | `60%` a `85%` de `CONTEXT_PROMPT_GC_TOKEN_THRESHOLD` |
| `CONTEXT_SUMMARY_COMPACTION_INTERVAL` | Intervalo (em turnos) entre compactações de resumo contextual. | `4` (mínimo efetivo: `1`) | Intervalo menor compacta com mais frequência (menos crescimento de contexto, mais processamento). | `2` a `8` |
| `CONTEXT_SIMILARITY_HISTORY_LIMIT` | Janela de histórico usada para heurísticas de similaridade/repetição de contexto. | `12` (mínimo efetivo: `3`) | Janela maior melhora detecção de repetição; pode aumentar latência de decisão. | `8` a `24` |

### Limites de economia (`ECONOMY_*`, `ECO1_*`, `ECO2_*`, `ECO3_*`)

#### Perfil `ECONOMY_*`

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `ECONOMY_TASK_DESCRIPTION_MAX_CHARS` | Limite da descrição de tarefa no modo econômico. | `min(TASK_DESCRIPTION_MAX_CHARS, 6000)` | Reduz custo de entrada no modo econômico; limite muito baixo pode remover requisitos importantes. | `3000` a `8000` |
| `ECONOMY_TOOL_OUTPUT_STRING_LIMIT` | Limite por string de saída de tool no modo econômico. | `min(TOOL_OUTPUT_STRING_LIMIT, 6000)` | Controla custo de contexto vindo de tools; baixo demais pode truncar evidências úteis. | `2000` a `7000` |
| `ECONOMY_TOOL_OUTPUT_SERIALIZED_LIMIT` | Limite total serializado de payload de tools no modo econômico. | `min(TOOL_OUTPUT_SERIALIZED_LIMIT, 15000)` | Diminui payloads volumosos; muito baixo pode comprometer diagnóstico de erros. | `8000` a `25000` |
| `ECONOMY_HTTP_TOOL_MAX_RESPONSE_CHARS` | Máximo de caracteres devolvidos por `http_get` no modo econômico. | `min(HTTP_TOOL_MAX_RESPONSE_CHARS, 8000)` | Respostas menores reduzem custo de inspeção web; valores baixos podem cortar contexto da página. | `3000` a `12000` |

#### Perfil `ECO1_*`

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `ECO1_TASK_DESCRIPTION_MAX_CHARS` | Limite da descrição de tarefa no perfil ECO-1. | `min(TASK_DESCRIPTION_MAX_CHARS, 5000)` | ECO-1 prioriza custo; valor baixo acelera ciclos, com maior risco de omissão de detalhes. | `2500` a `7000` |
| `ECO1_TOOL_OUTPUT_STRING_LIMIT` | Limite por string de saída de tool no ECO-1. | `min(TOOL_OUTPUT_STRING_LIMIT, 4000)` | Corta rapidamente saídas extensas, reduzindo tokens totais por iteração. | `1500` a `5000` |
| `ECO1_TOOL_OUTPUT_SERIALIZED_LIMIT` | Limite serializado de saída de tools no ECO-1. | `min(TOOL_OUTPUT_SERIALIZED_LIMIT, 12000)` | Mantém mensagens compactas; se baixo demais, pode perder stack traces e diffs úteis. | `6000` a `16000` |
| `ECO1_HTTP_TOOL_MAX_RESPONSE_CHARS` | Máximo de resposta de `http_get` no ECO-1. | `min(HTTP_TOOL_MAX_RESPONSE_CHARS, 6000)` | Ajuda a conter scraping pesado em modo econômico agressivo. | `2000` a `9000` |

#### Perfil `ECO2_*`

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `ECO2_AUTO_COMPACT_TOKEN_LIMIT` | Limiar de tokens para auto-compactação no ECO-2. | `1000000` | Define teto de crescimento de contexto antes de forçar redução. | `400000` a `1200000` |
| `ECO2_HISTORY_TARGET_TOKENS` | Meta de histórico após compactação no ECO-2. | `min(ECO2_AUTO_COMPACT_TOKEN_LIMIT, 800000)` | Controla o “ponto de equilíbrio” entre memória e custo no perfil. | `50%` a `85%` do `ECO2_AUTO_COMPACT_TOKEN_LIMIT` |
| `ECO2_USER_MESSAGE_TOKEN_LIMIT` | Limite de tokens para mensagem do usuário no ECO-2. | `20000` (teto efetivo: `50000`) | Evita entrada excessiva por turno; valores altos podem aumentar latência e custo por request. | `8000` a `30000` |
| `ECO2_TOOL_OUTPUT_STRING_LIMIT` | Limite por string de saída de tool no ECO-2. | `min(TOOL_OUTPUT_STRING_LIMIT, 5000)` | Balanceia qualidade de diagnóstico e custo de contexto em loops longos. | `2000` a `7000` |
| `ECO2_TOOL_OUTPUT_SERIALIZED_LIMIT` | Limite serializado de saída de tools no ECO-2. | `min(TOOL_OUTPUT_SERIALIZED_LIMIT, 18000)` | Mantém payload controlado em iterações repetidas de análise. | `10000` a `30000` |
| `ECO2_HTTP_TOOL_MAX_RESPONSE_CHARS` | Máximo de resposta de `http_get` no ECO-2. | `min(HTTP_TOOL_MAX_RESPONSE_CHARS, 10000)` | Evita expansão excessiva do prompt com conteúdo HTTP. | `3000` a `15000` |
| `ECO2_APPROX_CHARS_PER_TOKEN` | Fator heurístico chars/token para estimativas internas de orçamento. | `4` | Estimativa baixa pode subestimar tokens reais; alta pode compactar cedo demais. | `3` a `5` |
| `ECO2_MAX_IDENTICAL_TOOL_ATTEMPTS` | Máximo de tentativas idênticas de tool antes de marcar estagnação. | `3` (mínimo efetivo: `2`) | Valor menor reduz loops inúteis; valor maior permite insistência em ambientes instáveis. | `2` a `5` |
| `ECO2_LOOP_HISTORY_SIZE` | Tamanho do histórico para detectar repetição de chamadas no ECO-2. | `ECO2_MAX_IDENTICAL_TOOL_ATTEMPTS * 3` (mínimo efetivo: `>= ECO2_MAX_IDENTICAL_TOOL_ATTEMPTS`) | Janela maior melhora detecção de ciclo, mas custa mais memória/CPU de controle. | `6` a `18` |

#### Perfil `ECO3_*`

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `ECO3_AUTO_COMPACT_TOKEN_LIMIT` | Limiar de tokens para auto-compactação no ECO-3. | `600000` | ECO-3 compacta mais cedo que ECO-2 por padrão, priorizando custo previsível. | `250000` a `900000` |
| `ECO3_HISTORY_TARGET_TOKENS` | Meta de histórico após compactação no ECO-3. | `min(ECO3_AUTO_COMPACT_TOKEN_LIMIT, 450000)` | Define quanto contexto histórico permanece após GC em ECO-3. | `50%` a `85%` do `ECO3_AUTO_COMPACT_TOKEN_LIMIT` |
| `ECO3_USER_MESSAGE_TOKEN_LIMIT` | Limite de tokens para mensagem do usuário no ECO-3. | `10000` (teto efetivo: `30000`) | Limite menor força prompts mais objetivos e ciclos mais baratos. | `5000` a `20000` |
| `ECO3_TOOL_OUTPUT_STRING_LIMIT` | Limite por string de saída de tool no ECO-3. | `min(TOOL_OUTPUT_STRING_LIMIT, 3000)` | Forte contenção de verbosidade de tools para jobs longos. | `1000` a `5000` |
| `ECO3_TOOL_OUTPUT_SERIALIZED_LIMIT` | Limite serializado de saída de tools no ECO-3. | `min(TOOL_OUTPUT_SERIALIZED_LIMIT, 12000)` | Evita crescimento explosivo do contexto por logs extensos. | `6000` a `18000` |
| `ECO3_HTTP_TOOL_MAX_RESPONSE_CHARS` | Máximo de resposta de `http_get` no ECO-3. | `min(HTTP_TOOL_MAX_RESPONSE_CHARS, 8000)` | Reduz ingestão de HTML/texto em cenários de economia agressiva. | `2000` a `10000` |
| `ECO3_MAX_TURNS` | Quantidade máxima de turnos do loop no ECO-3. | `600` | Impõe limite duro de execução para evitar sessões intermináveis. | `120` a `800` |
| `ECO3_MAX_TOTAL_TOKENS` | Orçamento máximo total de tokens consumidos no ECO-3. | `1600000` | Atua como fusível de custo total do job no perfil. | `300000` a `2000000` |

### Limites de saída de tools (`TOOL_OUTPUT_*`)

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `TOOL_OUTPUT_STRING_LIMIT` | Limite de caracteres por string retornada por qualquer tool. | `12000` | Principal controle de verbosidade unitária de tool output no perfil padrão. | `6000` a `20000` |
| `TOOL_OUTPUT_SERIALIZED_LIMIT` | Limite total serializado do payload de retorno das tools. | `60000` | Limita objetos grandes/arrays extensos no contexto do modelo. | `20000` a `100000` |

### Limites de tool HTTP/shell (`HTTP_TOOL_*`, `RUN_SHELL_*`)

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `HTTP_TOOL_TIMEOUT_MS` | Timeout de chamadas da tool `http_get`. | `15000` | Timeout baixo evita bloqueios de rede; alto aumenta tolerância a endpoints lentos. | `5000` a `30000` |
| `HTTP_TOOL_MAX_RESPONSE_CHARS` | Limite de caracteres retornados por `http_get` antes de truncar. | `20000` | Controla ingestão de payload HTTP no contexto base. | `8000` a `40000` |
| `RUN_SHELL_TIMEOUT_MS` | Tempo máximo por execução da tool `run_shell`. | `300000` | Define SLA de comandos; se baixo, pode matar builds/testes legítimos. | `120000` a `900000` |
| `RUN_SHELL_MAX_BUFFER_BYTES` | Buffer máximo acumulado de `stdout`/`stderr` por comando `run_shell`. | `5242880` (`5 MiB`) | Protege memória e contexto contra logs massivos; limites baixos aumentam truncamento de saída. | `1048576` a `15728640` |

### Banco para tool de consulta (`DB_*`)

| Variável | Descrição | Default em código | Impacto operacional | Faixa sugerida |
| --- | --- | --- | --- | --- |
| `DB_URL` | URL de conexão do banco para a tool de consulta (`mysql:`/`mariadb:`; aceita prefixo `jdbc:`). | *(sem default; opcional, pode usar `DATABASE_URL` como fallback)* | Sem URL válida, a tool de consulta falha por ausência de configuração de banco. | URL explícita por ambiente (`mysql://host:3306/database`) |
| `DB_USER` | Usuário de autenticação do banco usado pela tool de consulta. | *(sem default)* | Credencial obrigatória para habilitar consultas SQL via tool. | Usuário dedicado com privilégios mínimos (read-only quando possível) |
| `DB_PASS` | Senha do usuário do banco para a tool de consulta. | *(sem default)* | Sem senha (ou senha inválida), não há conexão. Tratar como segredo. | Definir via secret manager/CI, nunca em texto plano no repositório |
| `DB_QUERY_TIMEOUT_MS` | Timeout por consulta SQL na tool de banco. | `10000` | Limita consultas lentas e evita travamentos no loop de tools. | `3000` a `30000` |
| `DB_QUERY_MAX_ROWS` | Quantidade máxima de linhas retornadas por consulta SQL. | `200` | Controla volume de dados retornado ao modelo e custo de contexto. | `50` a `500` |

## Docker

O Dockerfile publicado pela pipeline gera uma imagem enxuta baseada em `node:20-alpine`. Para executar localmente:

```bash
docker build -t sandbox-orchestrator apps/sandbox-orchestrator
docker run --rm -p 8083:8083 sandbox-orchestrator
```

Com Docker Compose (na raiz do monorepo) o serviço é iniciado automaticamente com o backend e frontend.
