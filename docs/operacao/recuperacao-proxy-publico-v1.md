# Recuperação controlada do proxy público — contrato v1

## Problema e causa-raiz

Pergunta obrigatória: **por que esse erro aconteceu?**

A tarefa Psique 259 falhou porque o proxy HTTPS do host do Marketing Hub permaneceu parado após
um reboot. O executor Linux do AI Hub não resolve a causa: ele executa shell no host do próprio AI
Hub, não alcança o daemon do host do proxy e, quando exposto publicamente, amplia autoridade sem
fornecer identidade, idempotência, cooldown ou auditoria da operação.

## Decisão de arquitetura

| Alternativa | Benefício | Risco/custo | Decisão |
| --- | --- | --- | --- |
| Reusar `linux-command` | Implementação curta | Shell arbitrário, host errado e nenhuma garantia de resultado | Descartada |
| Dar credencial GitHub diretamente ao MCP de borda | Menos um salto HTTP | Duplica autenticação GitHub e auditoria no componente exposto | Descartada |
| MCP semântico → backend AI Hub → workflow restrito | Reusa GitHub App e persistência, fixa o alvo e separa controle de execução | Dois contratos coordenados | Escolhida |

## Contrato de autoridade

- Operação pública única: `recover-public-proxy`.
- A operação permanece desabilitada por padrão e o deploy oficial a habilita explicitamente.
- Autenticação bearer obrigatória e fail-closed em toda rota `/mcp/tools/**`.
- O shell genérico continua disponível apenas na rede interna para as rotinas legadas autenticadas;
  o Caddy devolve `404` para `/mcp/tools/linux-command` no caminho público.
- O `Caddyfile` vem somente da imagem versionada; nenhum bind mount remoto pode sobrepor a regra
  aprovada pela CI.
- O chamador fornece somente `requestId`, `reason` e a confirmação literal
  `RECOVER_PUBLIC_PROXY`.
- Repositório, workflow, branch, host, projeto Compose, serviço, imagem, redes e sondas são fixados
  por configuração operacional; nenhum deles vem do payload.
- O backend persiste idempotência, cooldown, status e referência da execução GitHub.
- Repetir o mesmo `requestId` nunca cria um segundo despacho; reutilizá-lo com outro motivo falha.
- Uma execução só vira `RECOVERED` quando o workflow termina com conclusão `success`. O workflow,
  por sua vez, só conclui depois de validar HTTPS, `/healthz` e o contrato PDE.
- A operação não faz build, pull, rsync, prune, commit, push, PR, deploy de código ou troca de
  imagem.

## Matriz de homologação local

| Área | Cenários obrigatórios | Evidência de aprovação |
| --- | --- | --- |
| Caminho feliz | bearer válido, despacho único, execução encontrada e conclusão `success` | status final `RECOVERED`, run ID/URL e auditoria |
| Validações | UUID, motivo sem controles, confirmação literal e payload sem alvo livre | `400` sem chamada ao GitHub |
| Autorização | token ausente, incorreto e configuração ausente | `401`/`503`; nenhuma execução |
| Idempotência/cooldown | repetição igual, repetição divergente e novo pedido dentro da janela | um único despacho; `409`/`429` nos conflitos |
| Integração GitHub | erro de dispatch, run ainda ausente, queued, in progress, success e failure | estados determinísticos sem falso positivo |
| Persistência | migração e unicidade de `request_id` em H2, MySQL 5.7 e PostgreSQL | tabela criada e duplicata rejeitada nos três bancos |
| Workflow | alvo fixo, concorrência unitária, confirmação, SSH protegido e comandos proibidos ausentes | teste de contrato e `actionlint` |
| Proxy Docker | parado, processo encerrado, container ausente com imagem local e falha de health | recuperação/recriação somente do proxy e sondas locais |
| Observabilidade | transições, motivo, run ID/URL e diagnóstico limitado | registros persistidos sem secrets |
| Segregação | topologia efêmera exclusiva e nenhum evento comercial | projeto Compose `aihub-f3beba86-6e86-438e-9f49-8366727ec8a4-3960973722` removido ao final |
| Superfície HTTP | health público, operação semântica autenticada e shell bloqueado na borda | testes do controller e contrato do Caddy |

Não há interface visual neste fluxo; portanto navegadores, iOS e Android não alteram o contrato de
homologação. O consumidor é HTTP e será validado pelo mesmo JSON que um cliente MCP utiliza.

## Critérios de decisão

- **Continuar:** despacho único, trilha auditável e duas rodadas completas consecutivas sem falhas
  após a última correção.
- **Ajustar:** qualquer ambiguidade de estado, dependência de arquivo ainda não publicado no host,
  vazamento de detalhe sensível ou sonda parcial.
- **Parar:** possibilidade de shell público, alvo controlado pelo payload, publicação de código ou
  sucesso declarado sem as três sondas.
