# Homologação do acompanhamento de execução

O detalhe da solicitação apresenta o checklist, uma linha do tempo de eventos públicos e o resumo complementar em áreas separadas. A fonte do trace é o ciclo de vida dos itens do Codex App Server, nunca o conteúdo bruto de raciocínio. O contrato é `executionTrace.version = 1`, persistido como JSON independente de `reasoningSummary`; pedidos antigos continuam legíveis sem backfill ou horários inventados.

## Decisões

Investigação: **“por que esse erro aconteceu?”** O coletor convertia planos em Markdown, colapsava pendente/executando e sobrescrevia as versões anteriores; o frontend não recebia a estrutura dos eventos. Refinar somente o prompt tem baixo custo, mas mantém a perda de dados. Separar o painel com apenas o snapshot tem custo intermediário, mas não reconstrói falhas. Preservar snapshots e eventos já existentes tem custo intermediário e atende à verificação de resultados e retomadas; esta foi a alternativa escolhida.

Os estados do checklist são declarações do modelo. Eventos observados durante a etapa ativa são vinculados ao snapshot correspondente por turno/índice, sem afirmar que o sucesso de um comando comprova todos os critérios da etapa. Ausência de evidência é explícita. Horários de recebimento e duração medida são identificados; duração do provedor tem precedência. Falhas de comando dependem também do exit code, e retomadas preservam a tentativa anterior. Eventos repetidos não geram linhas adicionais.

Títulos, estados e resultados gerados pelo sistema ficam em português. Atualizações públicas do agente recebem instrução de concisão e idioma. Resumos automáticos do provedor são preservados em detalhes expansíveis: não há tradução adicional, chamada paga ou interpretação de conteúdo oculto. Saídas técnicas são limitadas e sanitizadas antes de sair do orquestrador; links de evidência aceitam apenas HTTP(S) sem credenciais. Limites e perdas de eventos ficam explícitos no contrato e painel.

## Matriz definida antes dos testes

| Critério | Validação local |
| --- | --- |
| Caminho feliz | Plano pendente/executando/concluído, comando com resultado, arquivo e evidência; resumo e resposta final separados |
| Validações | Eventos malformados, estado desconhecido, resumo ausente, contrato legado, trace inválido e links inseguros |
| Falhas e recuperação | Exit code não zero, tool com erro, turno interrompido, nova tentativa, completion sem start e eventos repetidos/atrasados |
| Integração | Processo JSON-RPC sintético → orquestrador → polling/callback autenticado → backend/H2 migrado → detalhe React no Chromium |
| Observabilidade | Horário, duração, IDs de turno/item, histórico do plano, vínculo à etapa ativa, contagens e limites; ausência de resultado explícita |
| Métricas e isolamento | Resposta/cota/tokens existentes preservados; IDs e ambiente `sandbox.local`; outra thread/solicitação excluída; nenhum teste pago ou escrita produtiva |
| Segurança | Conteúdo bruto de reasoning excluído; tokens sintéticos, bearer, URL com credenciais e argumentos privados sanitizados; links javascript/data recusados |
| Dispositivos | Chromium desktop e iPhone 15 Pro emulado, layout sem overflow, expansão de detalhes e navegação por evidências |
| Regressão | Suítes pertinentes do orquestrador/backend/frontend, builds, lint, migração MySQL 5.7 local, actionlint e revisão do diff |

## Harness

A lacuna observada é que as fixtures e testes aprovavam a mistura entre plano e resumo, e a CI não executava o teste do painel de resumo. As regressões passam a proteger estados, histórico, isolamento, deduplicação, sanitização e o percurso JSON-RPC/callback/persistência/interface, reutilizando os mecanismos de fixtures existentes.
