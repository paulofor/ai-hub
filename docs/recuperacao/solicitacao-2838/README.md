# Código recuperado da solicitação #2838

## Resultado

Recuperados os **26 arquivos de código, testes e documentação** das telas de
detalhes de Opala, Quartzo e Safira. A fonte veio do `unified_diff` da resposta
**5084**, gravada em **2026-09-15 08:23:49 UTC**, correspondente à solicitação
[#2838](https://iahub.xyz/codex/requests/2838), “Detalhes dos tipos publicados”.

O pacote [marketing-hub.patch](marketing-hub.patch) foi aplicado e validado
localmente sobre a `main` do Marketing Hub em
`1acb79eb7ec62a43ae585e9543e84e4ab049492c` (a referência completa conferida consta
do [manifesto](manifest.json)). Cinco arquivos de pesquisas que já estavam
integrados foram excluídos do pacote. Nenhum arquivo da funcionalidade foi omitido.
O pacote também contém **cinco arquivos complementares**: a correção do
reconciliador de publicação, seus testes, o cânone da retomada e dois registros de
documentação. O manifesto distingue os 26 arquivos recuperados desses complementos.

O checkout de homologação está em `.local-code-recovery/marketing-hub`, ignorado
pelo Git do AI Hub. Este pacote textual e seu manifesto permanecem no conjunto
de alterações do AI Hub para que a recuperação não dependa desse diretório
temporário. O código do Marketing Hub deve ser integrado no seu próprio repositório;
adicionar este pacote ao AI Hub não integra automaticamente aquelas telas.
O atributo de whitespace deste diretório preserva os espaços de contexto exigidos
pelo formato unified diff; sua integridade foi conferida por `git apply --check`,
aplicação local, conferência reversa e SHA-256, sem normalizar o patch original.

## Diagnóstico e decisão

- As solicitações #2844 e #2845 indicavam o commit
  `12e2e35ab4db307990924062eba6e243cb054062` indisponível no GitHub.
- A leitura do coordenador no host administrativo confirmou `AWAITING_MERGE`
  com esse mesmo commit. Os PRs #5194 e #5196 estavam integrados, mas a fonte das
  telas não estava na `main`.
- A API de respostas fornece somente os dez registros mais recentes; o registro
  original já estava fora dessa janela. Uma consulta de leitura com as credenciais
  de banco já disponíveis na sandbox encontrou a resposta 5084. O SQL foi restrito
  ao repositório e ao intervalo de término da solicitação.
- O documento de homologação recuperado registra que o modelo transferiu a
  implementação para outra branch local antes da publicação manual histórica.
- No orquestrador versionado, a reprodução local confirmou que o checkout da
  branch remota ao finalizar descartava commits locais do resultado publicado.
  Falhas de push também eram ocultadas e o workspace era apagado. Seis dos sete
  cenários de preservação falhavam antes da correção. Os logs completos da execução
  histórica não estavam disponíveis; essa reprodução comprova o defeito do código,
  sem afirmar exclusividade causal para o incidente antigo.
- A revisão recuperada terá outro SHA. O coordenador já permite uma retomada
  auditada com essa nova revisão e sua evidência, mas o reconciliador ignorava esse
  registro e continuava consultando o SHA desaparecido. Três testes reproduziram
  o defeito. A correção respeita `integrated_commit` e `validation_evidence`
  registrados por `resume`, inclusive após retomada parcial, e preserva a
  preparação original. Antes de qualquer retomada auditada, o SHA antigo ausente
  continua bloqueando a publicação.

| Recuperação considerada | Benefício | Limite / esforço | Escolha |
| --- | --- | --- | --- |
| Recuperar o objeto Git original | Preserva também o SHA esperado pelo coordenador | Objeto não localizado no GitHub ou nos diretórios acessíveis | Não disponível |
| Restaurar o diff persistido e testar na main atual | Recupera código e testes originais; preserva evoluções posteriores | Exige homologar a composição e reconciliar a identidade da revisão | Executada |
| Reimplementar a partir das telas publicadas | Permite reconstruir comportamento sem a fonte | Maior esforço e risco de omitir regras e testes | Desnecessária |

## Validação local concluída

A matriz original recuperada em `infra/testing/product-type-detail/` e as suítes
completas dos módulos de preservação e retomada foram executadas na sandbox com
credenciais de teste, dados sintéticos e GitHub/transporte simulados.

| Verificação | Resultado desta recuperação |
| --- | --- |
| Orquestrador AI Hub | 120 testes aprovados, incluindo sete cenários de preservação com Git real local |
| Coordenador Marketing Hub | 33 testes aprovados |
| Reconciliador Marketing Hub | 44 testes aprovados, incluindo três regressões da revisão recuperada |
| Backend: tipos, produtos e arquitetura | 177 testes aprovados |
| Controller, service e JDBC com MySQL 5.7 real isolado | 8 testes aprovados |
| Frontend: detalhe, catálogo, produtos, navegação e API | 43 testes aprovados |
| Navegador | 12 grupos aprovados: 3 tipos × 3 dispositivos, mais falhas/recuperação em cada dispositivo |
| Dispositivos | Chromium desktop, iPhone 15 Pro e Pixel 7 emulados |
| Observabilidade e segregação | 42 consultas locais; zero mutações, chamadas pagas ou dados produtivos |
| Qualidade | TypeScript, build, Spotless, Prettier e diff aprovados |
| Limpeza | Zero containers, redes ou volumes do projeto Compose após `down --volumes --remove-orphans` |

A primeira rodada das telas passou sem alteração do código recuperado. A revisão
posterior identificou o defeito complementar no reconciliador. Depois dessa última
correção, a matriz ampliada passou em **duas rodadas completas consecutivas**
(`round-2` e `round-3`), com **425 testes e 12 grupos de navegação aprovados em cada
rodada**, sem falhas ou testes ignorados.

Comandos executados em cada rodada com ambiente restrito, sem credenciais reais
(primeiro no AI Hub; demais no checkout Marketing Hub):

```bash
npm --prefix apps/sandbox-orchestrator test
python3 scripts/test-deploy-intervention.py
python3 scripts/test-publisher-recovery.py
PRODUCT_TYPE_COMPOSE_PROJECT=aihub-072c319f-d78f-4fc5-8f6b-cf6a361bc695-211b9cd21f \
  python3 infra/testing/product-type-detail/run-round.py round-2
```

Na rodada seguinte, o último argumento foi `round-3`. Logs das suítes estão em
`.local-code-recovery/complete-{2,3}-*.log`; logs e capturas das telas estão no
checkout Marketing Hub em `artifacts/product-type-detail/round-{2,3}/`. O resumo
de navegação e hashes dos logs constam de [validacao.json](validacao.json).
Capturas desktop/mobile foram inspecionadas e permanecem fora do Git. O build
mantém o aviso preexistente de bundle grande; a fixture não fornece o logotipo
global preexistente, sem afetar o conteúdo das telas recuperadas.

## Aplicação e limite da recuperação

Em um checkout limpo do **Marketing Hub**, a conferência e a aplicação usam:

```bash
git apply --check /caminho/ai-hub/docs/recuperacao/solicitacao-2838/marketing-hub.patch
git apply /caminho/ai-hub/docs/recuperacao/solicitacao-2838/marketing-hub.patch
```

Essas operações já foram realizadas nesta sandbox. Se a base avançar, conferir
novamente o diff e a matriz antes da integração pelo fluxo de PR do usuário.

**O conteúdo-fonte foi recuperado; o objeto Git do antigo SHA não foi recuperado.**
A restauração por patch produzirá outra revisão. O coordenador de publicação ainda
referencia o SHA antigo; sua pausa não foi removida nem sua evidência substituída.
Depois que esta recuperação for integrada ao Marketing Hub pelo PR do usuário, a
retomada existente pode registrar a revisão efetivamente integrada e a nova
evidência com `resume --id 983c827dbf6c477daab5006788d1d55b
--integrated-commit <sha-integrado> --evidence <homologacao-da-recuperacao>`.
O reconciliador corrigido então acompanha a revisão autorizada, verifica novamente
a integração na main e recupera as publicações pendentes, preservando o registro
antigo. Não é correto declarar o commit antigo integrado só porque o patch foi
aplicado, nem liberar publicadores apenas trocando o SHA esperado.

Nenhum commit de entrega, push, PR, pipeline ou deploy foi executado nesta
recuperação. Os commits e pushes dos testes do orquestrador usaram somente remotos
Git locais descartáveis.
