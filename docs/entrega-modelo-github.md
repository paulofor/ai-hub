# Entrega do modelo até o deploy

Para solicitações de implementação ou correção em um repositório, o modelo deve executar a tarefa, validar localmente, abrir ou atualizar o PR, revisar, aprovar quando a identidade autenticada puder fazê-lo, realizar o merge na `main` e acompanhar os workflows e deploys associados à entrega. Uma restrição explícita do usuário, como “somente local”, continua prevalecendo. Análises sem mudanças e o perfil Sandbox sem Git não iniciam publicação.

## Critério de conclusão

1. Investigar a causa raiz, implementar e testar na sandbox, revisar o diff e os critérios da solicitação antes do primeiro commit/push.
2. Reutilizar o PR da tarefa ou abrir um PR para `main`. Conferir os checks do HEAD atual e resolver conflitos localmente. Aprovar somente com identidade e permissões válidas; respeitar revisões obrigatórias e proteções, sem autoaprovação pelo autor ou bypass administrativo.
3. Fazer o merge depois dos checks e revisões exigidos. Registrar o SHA resultante e acompanhar todos os workflows aplicáveis ao PR e a esse SHA na `main`, incluindo workflows de deploy encadeados. Reconsultar a lista porque nem todos aparecem imediatamente.
4. Em falha, examinar o job e os logs, corrigir a causa localmente e executar as validações relacionadas antes de atualizar o PR. Se já houve merge, usar um PR de correção e acompanhar seu novo SHA. Reexecutar sem mudança somente quando houver evidência de falha transitória.
5. Confirmar sucesso de todos os workflows/jobs obrigatórios e deploys previstos. `queued`, `in_progress`, `waiting`, `failure`, `cancelled`, `timed_out`, `action_required` e ausência de um deploy esperado não são sucesso. Um job `skipped` só é aceitável quando sua condição documentada não se aplica à mudança.
6. Verificar a versão/saúde publicada quando houver endpoint disponível e responder com links do PR, workflows, SHA e evidências do deploy. Sem acesso, aprovação obrigatória ou recurso externo, comunicar o bloqueio e a ação mínima necessária, sem afirmar entrega concluída.

Imagens de produção continuam sendo construídas pelos arquivos e pipelines versionados; SSH e imagens manuais não substituem o fluxo de publicação. Artefatos do Marketing Hub continuam sendo criados pelo frontend: se for preciso implementar uma funcionalidade antes, concluir seu deploy e retomar a criação pelo frontend.

## Escopo técnico

Esta orientação é injetada no frontend, na retomada pós-PR e nos prompts do orquestrador (App Server e Responses API). Ela orienta a atuação do modelo durante a execução; não adiciona um coordenador persistente de GitHub nem transforma o estado técnico `COMPLETED` de um turno em comprovação independente de deploy. O botão existente de PR continua disponível para operação manual e histórico.

## Matriz de homologação local

| Cenário | Evidência esperada |
| --- | --- |
| Solicitação Managed e MKT pelo navegador | Payload com PR, revisão, merge, monitoramento e condição de conclusão, sem instruções antigas de aguardar clique/deploy |
| Prompts App Server e Responses API | Mesma política de entrega e manutenção da validação local anterior à publicação |
| Continuação após PR | Reutilizar o PR e prosseguir até deploy, preservando ambiente e contexto |
| Falhas/checks pendentes/revisão obrigatória | Orientar diagnóstico, correção local, bloqueio honesto e respeito às proteções |
| Retomada de entrega já integrada | Consultar revisões reais, SHA e deploys; evitar publicação redundante e preservar resposta e falhas reais |
| Solicitação com PR próprio em branch compartilhada reutilizada | Repetir o pedido de PR retorna somente o vínculo da solicitação; não substitui PRs de outros lotes |
| Novo lote e histórico com PR, inclusive com falha de encerramento | Fechar somente solicitações sem PR; vínculos existentes e métricas permanecem intactos |
| Associação conflitante | Rejeitar troca de PR já registrado, sem alterar o histórico |
| API → persistência → interface | Exercitar pedidos repetidos com H2, verificar links/estado/métricas e renderizar detalhes sintéticos em desktop e mobile |
| Análise sem alteração, restrição explícita e Sandbox sem Git | Não iniciar publicação fora do escopo |
| Integrações e observabilidade | Provedores e API simulados, preservar logs/métricas existentes e exigir evidência por SHA/run/deploy na orientação |
| Segregação | Somente repositórios temporários e fixtures sintéticas nos testes; sem gasto ou deploy de teste |
| Navegadores/dispositivos | Chromium desktop e Chromium com emulação iPhone 15 Pro para envio do prompt; nenhum layout novo |

A matriz valida a orientação emitida e a integração local. Não simula que um modelo necessariamente cumprirá instruções nem comprova uma publicação real.
