# Conferência do resultado MKT antes do encerramento

## Evidência e causa

Fonte: solicitação [#3276](https://iahub.xyz/api/codex/requests/3276), consultada
em 08/10/2026. O usuário relatou ter definido a janela de Capella e não saber
como continuar. A resposta informou uma melhoria de orientação publicada pelo
[PR #5520](https://github.com/paulofor/marketing-hub/pull/5520), mas também que
nenhuma implementação estava em execução. Não é correto dizer que não houve
alteração técnica; a passagem do produto permaneceu sem execução.

O trace público tem 296 eventos e seis versões do checklist, sem descartes.
Às 18:38:45 UTC de 06/10, o plano propunha corrigir o bloqueio de continuidade.
Às 18:43:33, depois de encontrar a falta do protótipo, passou a entregar apenas
a orientação da pendência. Às 19:52:50, todas as etapas foram concluídas com
a implementação ainda pendente. A análise usa pedido, resposta, planos,
operações e atualizações públicas; não reproduz raciocínio interno.

**Por que esse erro aconteceu?** O modelo tratou o relato contextual de
dificuldade como ajuste de orientação e reduziu o aceite ao encontrar a
dependência técnica. A política V2 já solicitava avanço, mas o orquestrador
aceitava o primeiro turno concluído e arquivava a thread sem uma conferência
do resultado original. Publicação técnica tornou-se o ponto de encerramento,
embora a resposta reconhecesse a ausência de execução da construção.

| Alternativa | Benefício | Risco / esforço | Decisão |
| --- | --- | --- | --- |
| Somente reforçar o prompt | Baixo esforço e melhor interpretação | V2 já continha orientações que não impediram o encerramento | Complemento |
| Conferir o resultado na mesma execução | Reusa contexto, ferramentas, métricas, cancelamento e recuperação; permite executar a omissão antes de responder | Um turno adicional de modelo; não substitui aceite independente do produto | Escolhida |
| Nova orquestração de agentes e produtos | Poderia coordenar toda a cadeia | Alto esforço, duplicação e escopo maior que a falha de encerramento | Não adotada |

## Matriz definida antes dos testes

| Área | Critério local |
| --- | --- |
| Caso #3276 | Resposta que só melhora orientação não encerra imediatamente; conferir pedido e plano inicial na mesma thread antes de publicar o resultado |
| Outra identidade | Mesmo comportamento em outro produto, sem IDs ou nomes fixos na implementação |
| Caminho já válido | Entrega comprovada passa por uma única conferência, sem repetição automática de tarefa ou publicação |
| Análise e limites | Conferência preserva análise, somente local, gasto, campanha, decisões e restrições; não é nova autorização |
| Integração | Job real com clone Git local e App Server simulado; só a resposta conferida chega ao resumo/callback |
| Falhas | Falha definitiva na conferência não retorna a resposta anterior como sucesso; falha transitória retoma a conferência na mesma thread |
| Cancelamento e isolamento | Cancelar impede turno seguinte; eventos de outra thread ou de turno anterior não encerram a conferência |
| Contexto | Primeiro checklist preservado mesmo depois de revisões/limite do trace; sem expor segredos ou conteúdo de reasoning |
| Observabilidade e métricas | Conferência identificável no trace público; tempo e consumo permanecem na mesma solicitação; nenhuma promessa de venda |
| Segregação | Repositórios temporários, produtos sintéticos e provedor simulado; sem novas chamadas pagas ou alterações comerciais na homologação |
| Navegadores | Sem novo componente visual; conferir renderização dos eventos existentes em Chromium desktop e Pixel 7 |
| Qualidade e entrega | Build e testes do orquestrador, regressões de trace, diff revisado; PR/revisões/checks, merge, CI/deploy e versão/saúde |

O teste determinístico comprova que o servidor exige a conferência e mantém o
ciclo aberto. O comportamento dos especialistas e o avanço comercial precisam
de evidência do Marketing Hub; não são inferidos de mocks ou do status COMPLETED.
Não há mudança de banco nem de shell.

## Resultado local

- Regressão reproduzida antes da correção: o job devolvia a orientação candidata
  com a implementação parada. Com a conferência, só a resposta do segundo turno
  encerra a execução com sucesso.
- 238 testes do orquestrador aprovados. Incluem clone Git local, callback,
  cancelamento antes/durante a conferência, falhas definitivas/transitórias,
  conferência vazia, deltas sem resposta final, snapshots terminais, isolamento
  entre turnos/threads, limites do trace e consumo acumulado de tokens.
- 24 cenários distintos de navegador aprovados: 22 existentes e dois novos em
  Chromium desktop/Pixel 7. Os novos usam payload do teste real do orquestrador
  e também foram conferidos com a fixture autônoma usada na CI. Captura mobile
  inspecionada, sem overflow ou erros JavaScript.
- A primeira fixture de navegador interceptava módulos Vite em `/src/api/`.
  Corrigida para restringir o pathname a `/api/`; revalidados somente os casos
  afetados. Não se alterou o produto para contornar uma falha da fixture.
- Build TypeScript, build/lint frontend, Bash/ShellCheck dos 20 scripts de primeira
  parte e Actionlint estrutural aprovados. Diff revisado antes da publicação.
- Evidências temporárias em `/tmp/aihub-3276` e `apps/frontend/test-results`;
  dados comerciais e credenciais não foram incluídos no repositório.
