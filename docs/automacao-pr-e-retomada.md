# Automação de PR e retomada de solicitações

## Pergunta respondida

É possível eliminar a intervenção do usuário entre a conclusão de uma alteração e a
continuação do trabalho. A automação, porém, deve ser responsabilidade do AI Hub,
e não depender de o modelo permanecer executando ou de a tela do navegador continuar
aberta.

## Por que hoje o fluxo para?

A causa raiz é a separação atual entre três ações:

1. a execução MKT produz e publica a branch de trabalho, mas é enviada ao
   orquestrador com criação automática de PR desabilitada;
2. a criação do PR só acontece quando a interface chama explicitamente o endpoint
   `create-pr`;
3. depois disso, a interface apenas prepara um novo prompt para o usuário enviar.

Portanto, não é uma incapacidade do modelo nem uma necessidade técnica do GitHub.
O bloqueio existe porque o estado do processo está no navegador e porque não há um
coordenador persistente que observe PR, merge, CI e deploy e então crie a próxima
execução.

## Caminho recomendado

Criar no backend um **fluxo autônomo opt-in por lote**, persistido e idempotente:

1. Ao concluir uma solicitação com `alterouCodigoRepositorio=true`, aguardar todas as
   execuções do lote terminarem e criar/reutilizar automaticamente o PR da branch do
   lote.
2. Persistir a fase do fluxo (`AGUARDANDO_PR`, `AGUARDANDO_MERGE`,
   `AGUARDANDO_DEPLOY`, `RETOMADA_ENFILEIRADA`, `CONCLUIDO`), a URL e o número do PR,
   além do identificador da execução que originou a retomada.
3. Receber webhooks do GitHub para `pull_request` e `workflow_run` (com uma reconciliação
   periódica como contingência). Quando o PR for mergeado e os checks/deploys
   configurados terminarem, enfileirar uma continuação no mesmo assunto e ambiente.
4. Gerar a continuação no backend com o contexto do lote e do PR, em vez de preencher
   o campo de texto da interface. O modelo então valida a publicação e executa as
   etapas restantes.
5. Exibir na conversa mensagens de sistema para cada transição, permitindo que o
   usuário acompanhe ou cancele o fluxo sem precisar acioná-lo manualmente.

## Limites de autonomia

- **Criar o PR:** pode ser totalmente automático com as credenciais que o sistema já
  usa para publicar a branch e chamar a API do GitHub.
- **Aprovar ou fazer merge:** só deve ser automático quando as regras do repositório
  permitirem e houver uma política explícita. Branch protection, revisão obrigatória
  ou aprovação humana devem continuar sendo respeitadas.
- **Retomar depois do merge/deploy:** pode ser totalmente automático; o AI Hub apenas
  espera o evento externo e inicia outra execução.
- **Decisões de negócio ou permissões:** continuam sendo bloqueios reais e devem ser
  apresentados ao usuário, sem tentar contorná-los.

## Proteções necessárias

- Chave idempotente por `lote + PR + fase`, para webhooks repetidos não criarem PRs ou
  execuções duplicadas.
- Limite de retomadas automáticas por lote, evitando ciclos de “corrigir, publicar e
  corrigir novamente” sem controle.
- Lista configurável de checks obrigatórios e um tempo máximo de espera.
- Estado de falha visível, com tentativa manual de reconciliação.
- Auditoria de quem habilitou o modo autônomo e de cada transição executada.
- Cancelamento que invalide tarefas já agendadas.

## Alternativas consideradas

1. **Automatizar cliques no frontend:** simples, mas depende do navegador aberto,
   perde estado em recargas e não reage com segurança a eventos do GitHub. Rejeitada.
2. **Pedir ao modelo para criar e acompanhar o PR na mesma execução:** reduz mudanças
   no produto, mas mantém um worker ocupado por tempo indefinido, dificulta retomada
   após reinício e mistura política de aprovação com raciocínio do modelo. Rejeitada.
3. **Máquina de estados persistente no backend com webhooks:** continua funcionando
   sem sessão web, é auditável, respeita proteções do GitHub e permite recuperação.
   Recomendada.

## Entrega incremental sugerida

1. **Fase 1:** opção “Criar PR automaticamente ao finalizar o lote”.
2. **Fase 2:** webhook/reconciliação de merge e checks, com atualização visual do
   estado.
3. **Fase 3:** retomada automática após deploy bem-sucedido, com limite de ciclos e
   botão de cancelamento.

Essa divisão entrega primeiro a remoção do clique em “Pedir PR” sem acoplar a criação
do PR à automação mais sensível de merge e publicação.
