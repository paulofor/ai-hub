# Fluxo de produtos e decisões visíveis — V2

Escopo: instruções das solicitações `CHATGPT_CODEX_MKT` para
`paulofor/marketing-hub` e resposta a pendências no diálogo desse ambiente.
Continua a política entregue no PR #761, merge
`aa1e703a3ab4b11215769a660420e7cc68767705`, CI/deploy `37314809806` concluído.

## Causa observada e decisão

**Por que esse erro aconteceu?** O contrato V1 orienta avanço e informa
pendências, mas não define uma explicação operacional completa da decisão
humana e da continuação entre agentes. No diálogo, o botão de orientação monta
`Execute sua orientação`, mesmo quando o texto pede uma decisão do usuário.
O estado visual ainda diz que foi enviado quando apenas preencheu um rascunho.
Isso permite confundir uma recomendação do modelo com a resposta do usuário.
São lacunas comprovadas no harness e na interface; não explicam sozinhas a
ausência de vendas nem demonstram falha de cada agente do Marketing Hub.

| Alternativa | Benefício | Risco / esforço | Decisão |
| --- | --- | --- | --- |
| Reforçar somente o prompt central | Cobre todas as novas solicitações | Mantém o atalho ambíguo de resposta; baixo esforço | Parcial |
| Evoluir contrato e resposta à pendência existente | Explica gargalo, decisão e continuação; exige resposta escrita do usuário | Esforço moderado, regressões de isolamento e envio | Escolhida |
| Criar nova máquina de orquestração/automações | Poderia coordenar novos executores | Duplica mecanismos existentes e amplia escopo sem evidência; alto esforço | Não adotada |

A V2 deve priorizar menor tempo até a próxima entrega aceita, remover repasses
manuais desnecessários, mostrar o estado comprovado e o responsável pelo próximo
passo. Quando depender do usuário, explicar decisão, motivo, opções/recomendação,
impacto, ação exata e continuação esperada. Preparação independente continua;
ações dependentes aguardam resposta real. Não prometer execução futura sem
mecanismo ativo comprovado. Reutilizar o JSON, o compositor e os registros atuais.

## Matriz de aceite definida antes dos testes

| Área | Validação local |
| --- | --- |
| Caminho feliz | Payload real de job com clone local e App Server simulado contém V2 uma vez; pedido e JSON preservados |
| Identidade | Somente perfil MKT e repositório exato; ambiente da mensagem determina a apresentação da pendência |
| Fluxo / harness | Contrato exige passagem aceita, redução de repasses, estado/responsável/evidência e retomada comprovada |
| Decisão | Conteúdo explica por que depende do usuário, opções, recomendação, custo quando conhecido, ação e consequência |
| Interface | Pendência em destaque antes do comentário; resposta vazia não gera rascunho; resposta explícita prepara mensagem, sem envio automático |
| Falhas e regressões | Falha de envio preserva a resposta; sem pendência não surge pedido de decisão; outros ambientes/perfis preservados |
| Integração | UI → payload HTTP simulado; job → App Server simulado; suites existentes sem chamadas pagas |
| Observabilidade / métricas | Marcador V2 auditável, erros JS ausentes, nenhum dado de venda/teste inserido em produção |
| Navegadores / dispositivos | Chromium desktop e Pixel 7 emulado, decisão, envio, troca de ambiente, layout sem overflow |
| Qualidade | TypeScript, lint, testes do orquestrador e Playwright pertinentes, revisão do diff |
| Entrega | Revisões/checks reais do PR, merge main, workflows/jobs aplicáveis e deploy bem-sucedidos, conferência pública |

Fixtures usam identidades sintéticas e APIs interceptadas. Não há campanha,
inferência paga, migração de banco ou alteração de shell nesta entrega. Testes
comprovam distribuição da instrução e comportamento da interface, não obediência
de todas as respostas futuras nem aumento de vendas. Acompanhamento comercial
usa passagens aceitas, tempo parado e intervenções humanas das fontes existentes.

## Ajuste decorrente da inspeção visual

A primeira rodada aprovou 220 testes do orquestrador, 28 do navegador, build e
lint. A inspeção das capturas revelou sobreposição dos indicadores sobre a
pendência em desktop e celular. **Por que aconteceu?** O quadro usava posição
fixa sem reservar espaço no conteúdo. Uma asserção de interseção reproduziu o
problema nos dois dispositivos antes da correção.

Comparadas três opções: ocultar indicadores automaticamente (baixo esforço,
perde visibilidade das métricas), colocá-los no fluxo normal do documento
(baixo esforço, conserva métricas e libera a leitura) ou refazer o layout com
coluna lateral reservada (maior esforço/escopo). Escolhida a segunda somente
quando o ambiente selecionado é o Marketing Hub ou há pendência dele no diálogo.
Regressão verifica ausência de sobreposição; demais ambientes preservam o quadro.

## Resultado local

- 220 testes do orquestrador aprovados, inclusive o caminho de job completo.
- 28 cenários de navegador aprovados na rodada inicial; após reproduzir e corrigir
  a sobreposição, 18 cenários relacionados aprovados, incluindo o contrato legado
  dos indicadores em outro ambiente. As capturas finais foram inspecionadas.
- Build TypeScript/Vite, ESLint e revisão do diff aprovados. Sem erros JavaScript
  nas jornadas instrumentadas. O Vite registrou consultas locais de polling ao
  encerrar algumas fixtures, recusadas pelo backend local ausente; testes e
  assertions de envio/falha usam API interceptada, sem acesso comercial.
- Evidências locais em `/tmp/mkt-flow-*-tests.log`,
  `/tmp/mkt-flow-frontend-final.log`, `/tmp/mkt-flow-overlap-repro.log` e
  `apps/frontend/test-results` (não versionadas).
- Nenhuma alteração funcional posterior à homologação. Publicação usa PR e
  imagens construídas pelos Dockerfiles/pipeline versionados; nenhum SSH direto.
