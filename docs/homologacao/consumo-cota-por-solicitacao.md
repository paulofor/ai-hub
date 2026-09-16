# Consumo de cota por solicitação

## Contrato

Os perfis `CHATGPT_CODEX`, `CHATGPT_CODEX_MKT` e `CHATGPT_CODEX_SANDBOX` consultam `account/rateLimits/read` antes de iniciar a thread e ao encerrar a execução no App Server, inclusive em falhas e interrupções. Retentativas dentro da mesma thread conservam a leitura inicial. Perfis de API sem cota ChatGPT e solicitações anteriores à implantação exibem **Indisponível**; não existe reconstrução retroativa.

A coluna nullable `codex_requests.quota_usage` guarda JSON versionado: leituras inicial/final, horário, identificador pseudonimizado da conta, limites, janelas, renovação, percentual utilizado, diferença em pontos percentuais, qualidade, concorrência observada, quantidade e último snapshot de eventos da conta. O payload de callback/polling transporta o objeto; a API de solicitações devolve a representação JSON textual, tanto no detalhe quanto nas duas projeções paginadas (com/sem avaliação). Tokens continuam nas métricas existentes.

Exemplo: 94% disponíveis no início e 92% no fim equivalem a 6% e 8% utilizados, portanto **2 p.p. estimados**. Cada janela é calculada separadamente; janelas diferentes nunca são somadas. Zero não prova ausência de consumo. Conta desconhecida/alterada, janela renovada/alterada, leitura ausente e redução incoerente não produzem delta. O consumo de outras tarefas ou ferramentas da mesma conta impede atribuição exata, mesmo quando não há concorrência local observada. Eventos da conta são evidência complementar; não substituem silenciosamente a leitura final.

A coleta tem timeout de 5 segundos por consulta de telemetria e não aborta a solicitação por falha de leitura. E-mail e erros brutos do provedor não são incluídos nessa telemetria. Callback vazio/antigo sem snapshot final não apaga a medição final. Os horários usam a mesma formatação/fuso do restante da aplicação.

Referência de contrato: [documentação oficial OpenAI do App Server](https://learn.chatgpt.com/docs/app-server), métodos `account/read`, `account/rateLimits/read` e eventos `account/rateLimits/updated`.

## Decisões

| Alternativa de coleta | Benefício | Risco / esforço | Decisão |
| --- | --- | --- | --- |
| Duas leituras | Implementação pequena | Menor contexto para auditoria | Viável, insuficiente para a sugestão completa |
| Leituras, eventos e tokens existentes | Rastreabilidade e visibilidade de concorrência | Esforço moderado; atribuição continua estimada | Escolhida |
| Serializar todos os trabalhos da conta | Reduz concorrência interna | Alto custo de vazão; uso externo permanece | Não atende bem à escala desejada |

| Alternativa de persistência | Benefício | Risco / esforço | Decisão |
| Colunas fixas para uma janela | Consultas SQL simples | Perde outras janelas e exige novas migrações | Não escolhida |
| Tabela de snapshots | Análise relacional detalhada | Mais entidades/joins e maior escopo | Reservada para evolução analítica |
| JSON versionado na solicitação | Preserva todas as janelas e metadados com uma migração | Agregações futuras exigirão extração JSON | Escolhida para a exibição e auditoria solicitadas |

## Matriz de homologação local

A matriz foi definida antes dos testes: caminho feliz, estados inválidos/falhas, integração e persistência, observabilidade/métricas, segregação de dados e navegação desktop/mobile.

| Critério | Evidência | Resultado |
| --- | --- | --- |
| Leituras antes/depois nos três perfis | `apps/sandbox-orchestrator/tests/quotaUsage.test.ts` | Sucesso, falha de turno/thread, interrupção e indisponibilidade aprovados |
| Diferenças e qualidade | Mesmo arquivo | 2 p.p., zero, múltiplas janelas, reset, expiração, redução, conta ausente/alterada e payload inválido aprovados |
| Concorrência e observabilidade | Mesmo arquivo | Snapshots independentes, marcação nos dois jobs, eventos, tokens, limpeza de listeners e ausência de dados sensíveis aprovados |
| Timeout do transporte | `codexAppServerClient.test.ts` | Request pendente removido e cliente ainda utilizável |
| Orquestrador → backend → banco → API | `CodexQuotaUsageIntegrationTest.java`, usando payload gerado pelo teste do orquestrador | Callback autenticado, rejeição sem token, persistência, detalhe e histórico com/sem filtro, isolamento entre solicitações e proteção contra callback antigo aprovados |
| Migração | `CodexQuotaUsageMigrationTest.java` e MySQL 5.7 efêmero local | SQL H2/PostgreSQL validado no H2; SQL MySQL executado duas vezes no MySQL real, preservando registro legado e persistindo delta 2 |
| Navegador → histórico → detalhe → recarga | `apps/frontend/tests/e2e/quotaUsage.spec.ts`, usando detalhe real exportado pelo teste Java | Três perfis em Chromium desktop e iPhone 15 Pro emulado; inicial/final/delta/horários e estados ausentes, em andamento, zero, reset e inválidos aprovados |
| Regressões | Suíte do orquestrador, testes Java selecionados e resumo de raciocínio no navegador | 148 testes do orquestrador; 63 Java; 4 testes de resumo; todos aprovados |
| Complementos após revisão | Suítes direcionadas de cota/transporte | 39 testes aprovados, incluindo dois casos adicionais; oito cenários de cota no navegador aprovados após ajustes |
| Build e diff | TypeScript/orquestrador, TypeScript/Vite/frontend, compilação Java e `git diff --check` | Aprovados; aviso preexistente de bundle grande no frontend |

A primeira execução dos testes de navegador revelou defeito na fixture: o padrão de mock `/api/` também capturava o módulo `/src/api/client.ts`. Corrigida a delimitação pelo pathname; repetidos apenas os testes de cota. A inspeção visual identificou horários da cota no fuso do navegador, diferentes do restante da tela; reutilizada `formatDateTime` e repetidos os oito cenários afetados.

### Reprodução do encadeamento local

```bash
cd apps/sandbox-orchestrator
QUOTA_E2E_PAYLOAD=/tmp/quota-e2e-payload.json npm test
cd ../backend
QUOTA_E2E_PAYLOAD=/tmp/quota-e2e-payload.json QUOTA_E2E_DETAIL=/tmp/quota-e2e-detail.json mvn -q -Dtest=CodexQuotaUsageIntegrationTest,CodexQuotaUsageMigrationTest,CodexRequestServiceTest,CodexControllerTest,CodexRequestTest test
cd ../frontend
QUOTA_E2E_DETAIL=/tmp/quota-e2e-detail.json npm run test:e2e -- quotaUsage.spec.ts
```

As fixtures usam conta/job/solicitação sintéticos, H2 em memória, MySQL efêmero e doubles de App Server/GitHub; não há uso de cota paga ou escrita em produção. Sem as variáveis, cada suíte utiliza sua fixture interna. MySQL foi executado somente no projeto Compose exclusivo da sessão, removido ao fim com volumes e órfãos.

## Limites e disponibilização

Não foi feita consulta autenticada real de cota, portanto a latência/precisão de atualização do provedor não foi homologada. O teste mobile usa Chromium emulado, não Safari/iPhone físico. PostgreSQL foi validado por compatibilidade SQL no H2, não por servidor PostgreSQL real. Não houve commit, push, PR, pipeline ou deploy. A disponibilização depende do fluxo de PR/publicação do usuário, incluindo a migração V52 e as versões correspondentes do backend, orquestrador e frontend.
