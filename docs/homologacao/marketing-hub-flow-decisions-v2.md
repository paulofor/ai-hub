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

## Parâmetros financeiros compreensíveis — 2026-10-06

O usuário recebeu “Defina a margem mínima de contribuição desejada para
Alcyone” sem definição do termo, base do percentual, exemplo ou indicação de
como informar a escolha. **Por que esse erro aconteceu?** A política V2 exige
uma decisão acionável, mas não exige traduzir um parâmetro de negócio antes de
solicitá-lo. O formulário já existe; a lacuna está no conteúdo solicitado ao
modelo, não na ausência de um cadastro financeiro comprovado.

| Alternativa | Benefício | Risco / esforço | Escolha |
| --- | --- | --- | --- |
| Explicar somente nesta conversa | Responde imediatamente | Próximos produtos podem repetir a orientação incompleta; baixo esforço | Complemento |
| Melhorar contrato central e contexto do formulário existente | Definição, unidade/base, exemplo e resposta explícita para qualquer produto | Baixo esforço; instrução não garante obediência de toda inferência futura | Adotada |
| Criar cadastro/calculadora financeira | Poderia estruturar parâmetros | Requer contrato de persistência e escopo sem evidência; esforço e risco maiores | Não adotada |

A margem é a sobra da receita após custos/despesas variáveis; sua contribuição
paga custos fixos e pode gerar lucro. Referência primária:
[Sebrae — Margem de contribuição](https://bibliotecas.sebrae.com.br/chronus/ARQUIVOS_CHRONUS/bds/bds.nsf/E809A7FF3D9553E90325714700620C06/%24File/NT00031FEA.pdf).
No contexto da orientação de Alcyone, considerar também aquisição, declarar a
base e evitar dupla contagem de descontos, reembolsos, impostos ou taxas.
Exemplo didático próprio: receita R$ 100 − entrega R$ 20 − taxas/impostos R$ 10
− aquisição R$ 30 = R$ 40, ou 40%. Não são custos reais de Alcyone nem uma meta
aprovada. O modelo não escolhe percentual nem autoriza mídia por inferência.

Matriz complementar definida antes da execução local:

| Área | Aceite |
| --- | --- |
| Contrato / integração | Job completo simulado entrega definição, unidade/base, exemplo e forma de resposta ao App Server; mantém isolamento MKT/repositório |
| Decisão / validações | Exemplo fictício não preenche resposta; entrada vazia não prepara; percentual explícito do usuário é preservado |
| Interface / integração | Texto explica termo e próxima atividade; preparar não envia; envio vai ao ambiente/produto/processo da origem |
| Falhas / regressões | Falha de envio preserva decisão; ausência de pendência, outro ambiente e outros perfis continuam sem gate financeiro |
| Observabilidade / métricas | Erros JS ausentes; testes interceptados com IDs sintéticos; nenhuma decisão, tarefa, custo ou venda criada em produção |
| Navegadores / dispositivos | Chromium desktop e Pixel 7 emulado, texto legível sem overflow; capturas inspecionadas |
| Qualidade / entrega | Suíte do orquestrador, build/lint e Playwright relacionados; diff revisado antes do PR; checks/merge/deploy e saúde pública conferidos |

As regressões de contrato comprovam distribuição das instruções; a fixture de
resposta no navegador comprova apresentação e envio. Não comprovam qualidade
de uma nova resposta de LLM, aplicação financeira pelo Marketing Hub ou vendas.
Nenhuma persistência de margem foi criada e nenhum valor real foi definido.

Resultado local: 222 testes do orquestrador e 30 cenários de navegador aprovados;
build e ESLint aprovados. A checagem adicional de tipos encontrou uma fixture
inline com propriedade excedente; corrigida conforme o padrão existente e
revalidados typecheck, lint e os dois cenários de margem desktop/Pixel 7, todos
aprovados. Capturas inspecionadas, sem overflow. Evidências em
`/tmp/mkt-margin-*.log` e `/tmp/mkt-margin-evidence` (não versionadas). Consultas
de polling ao encerrar fixtures chegam ao proxy Vite sem backend local e geram
ECONNREFUSED já observado na homologação anterior; a jornada testada usa API
interceptada e aprovou apresentação/envio/ausência de erros JS. Sem alterações
em shell, banco, workflow ou mecanismo de persistência.
