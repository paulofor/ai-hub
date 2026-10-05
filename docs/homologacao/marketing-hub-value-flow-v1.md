# Solicitações MKT orientadas ao fluxo de valor

Escopo: `CHATGPT_CODEX_MKT` + `paulofor/marketing-hub`. Política
`MARKETING_HUB_VALUE_FLOW_V1`, injetada pelo orquestrador no `turn/start`, inclusive
para pedidos sem o botão de cópia do Marketing Hub. Outros perfis/repositórios
mantêm suas orientações. Não altera pesos dos agentes, filas, orçamentos ou gates.

## Evidência e causa

Em 05/10/2026, a API do AI Hub retornou 78 solicitações desse ambiente entre as
100 mais recentes do perfil MKT, de 28/09 a 05/10: 73 `COMPLETED`, quatro `FAILED`
e uma `CANCELLED`. É uma amostra do histórico, não uma taxa de sucesso comercial.
Quinze detalhes foram consultados para comparar respostas e impedimentos.

- Solicitações #3182/#3183: descrevem preparação futura; não comprovam passagem.
- #3203/#3209/#3215, Capella; #3210/#3216, Mira: distinguem provas históricas,
  experimentos encerrados e limites atuais. Corrigir o histórico não ativa sucessor.
- #3211/#3217, Alcyone: faltam prova real da personalização, economia e aceite
  estratégico; a autorização de código não autoriza consumo pago adicional.
- #3218: `CODEX_TURN_STALLED`; #3212: interrupção por reinício. Não são evidências
  de rejeição do produto pelo mercado.
- #3126 registra o piloto de Mira com duas visitas atribuídas e nenhuma compra;
  é relato histórico consultado, sem reconciliação financeira nova nesta entrega.

Consultas atuais, somente leitura: cadeia 26 com seis processos; nove agentes;
Íris bloqueada após oito tentativas por ausência de linhagem da prova; quatro
agentes `NAO_INTEGRADO` na maturidade (Apolo, Argos, Dédalo, Íris). Isso demonstra
limites do monitor/fechamento compartilhado, não ausência de todas as execuções.
Fontes: `/api/business-process-chains/26`, `/api/agents`, `/api/agents/work-monitor`,
`/api/agents/maturity` e `/api/products` do Marketing Hub; solicitações em
`https://iahub.xyz/api/codex/requests/{id}`. Dados brutos não são versionados.

**Por que esse erro aconteceu?** A instrução central MKT do AI Hub priorizava
relatórios, sem discriminar repositório, passagem de atividade ou melhoria causal
reutilizável. O Marketing Hub já tinha um contrato mais completo no template
`frontend/src/pages/product/prompts/process-aihub-help.v1.md`, mas dependia de
cópia manual. A lacuna comprovada é de cobertura e consistência das instruções;
não se atribuem todos os bloqueios ou a ausência de vendas exclusivamente a ela.

## Decisão

| Alternativa | Benefício | Risco / esforço | Escolha |
| --- | --- | --- | --- |
| Alterar apenas o template copiado do Hub | Aproveita contexto oficial | Não alcança pedidos diretos; baixo esforço | Insuficiente |
| Reescrever contratos de todos os nove agentes | Poderia atacar capacidades individuais | Amplia escopo sem causa específica; alto esforço | Não adotada |
| Aplicar contrato central por perfil/repositório e contexto curto na tela | Alcança cada nova solicitação; evita exceção por produto | Exige regressão de isolamento; esforço moderado | Adotada |

A política manda verificar contexto vivo, trabalhar no gargalo, usar os agentes
responsáveis, corrigir o caso e a classe de falha, testar outra identidade,
preservar história/autoridade e conferir aceite/retorno/continuação no backend.
Análise permanece análise; progresso depende de evidências e autorizações reais.
O contexto da tela é curto; a política completa tem uma única fonte no servidor.
Não há novo mecanismo de orquestração nem chamada aos nove modelos nesta entrega.

## Matriz definida antes dos testes

| Área | Critério local de aceite |
| --- | --- |
| Caminho feliz | MKT + marketing-hub recebe política uma vez no `turn/start` real capturado pelo cliente simulado; pedido preservado |
| Identidade | Slug canônico, caixa/espaços, URL GitHub e sufixo `.git`; perfil técnico/sandbox, outro owner/repo, URL inválida e nome semelhante não recebem política |
| Integração | UI → payload HTTP simulado; job → clone local → App Server simulado; nenhum serviço pago necessário |
| Continuação | Mudança de ambiente atualiza interface e prompt sem carregar instrução/histórico do ambiente anterior |
| Contratos preventivos | Avanço/aceite, correção compartilhada, histórico encerrado, replay sem inferência, autoridade e segregação têm assertions derivadas dos casos observados |
| Falhas e regressões | Suíte existente de jobs preserva falhas/retomadas; testes existentes da tela preservam envio, falha, histórico e perfis |
| Observabilidade e métricas | Marcador versionado auditável no prompt; sem erros JS; nenhum evento de venda ou dado comercial gerado por teste |
| Dispositivos | Chromium desktop e Pixel 7 emulado, formulário, envio, seleção de ambiente e ausência de overflow |
| Qualidade | Build TypeScript, lint frontend, suíte do orquestrador, Playwright e revisão do diff |
| Entrega | PR com revisão real/checks do HEAD, merge, CI/main/build/deploy e conferência pública da interface e versão servida |

Fixtures, repositórios locais temporários e APIs simuladas são segregados. Testes
de contrato verificam o que é enviado ao modelo; não provam que toda resposta
futura obedecerá nem que haverá vendas. Não há nova inferência paga para avaliar
o prompt. Sem mudança de banco, Liquibase não se aplica. Sem edição de shell.

## Acompanhamento de negócio

Nas próximas solicitações, comparar passagens aceitas, tempo parado, recorrência,
intervenções e custo por tarefa concluída nas fontes existentes. Depois de tráfego
autorizado, usar compras líquidas, entrega e contribuição conciliadas por
experimento. Ausência de fonte permanece desconhecida; prontidão e PRs não contam
como venda. Não iniciar campanha, reabrir experimento ou pedir parecer pago só
para medir esta mudança.
