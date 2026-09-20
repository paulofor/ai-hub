# Homologação do encerramento das solicitações

## Critérios definidos antes da implementação

Os testes usam a classe real do orquestrador, repositórios Git bare via `file://`
(clone realmente raso), modelo e GitHub simulados e callbacks locais. Nenhuma
campanha, credencial externa ou métrica comercial recebe dados de teste.

| Cenário | Resultado exigido |
| --- | --- |
| Modelo integra o próprio PR e termina em main, branch de entrega ou HEAD destacado | COMPLETED; resposta e patch histórico preservados; nenhum push/PR redundante |
| HEAD é ancestral da main atual, com histórico raso | Completar histórico quando necessário e reconhecer entrega |
| Merge por squash/rebase mantém exatamente a mesma árvore de código | Reconhecer equivalência de conteúdo, sem exigir identidade de commits |
| Modelo deixa alterações locais após o merge (staged, unstaged ou untracked) | Publicar pelo fluxo normal ou falhar preservando o workspace; nunca descartar alterações |
| Commits novos e branch compartilhada ancestral em clone raso | Publicar mantendo exatamente os commits validados |
| Branch compartilhada realmente divergiu | FAILED; preservar resposta, erro, patch e workspace; nunca force-push |
| Consulta Git, expansão do histórico, push ou teste falham | Falha explícita; não converter ausência de evidência em sucesso |
| Resposta final em Markdown ou JSON MKT acompanhada de erro | Manter ambos legíveis, preservar JSON e status FAILED |
| Falha anterior à resposta do modelo | Exibir apenas o erro real |
| Callback repetido | Mesmo resultado, sem duplicação de avisos nem métricas |
| Histórico 3015, 3016 e 3017 | Restaurar somente após conferir final público, PR integrado e run do SHA correspondente; preservar tokens, custos e datas |

A API/callback e o banco são cobertos por testes locais com doubles. A interface
mantém o componente e o contrato existentes: conferir a apresentação em Chromium
desktop e emulação iPhone 15 Pro/Pixel 7 com dados sintéticos segregados. Não há
novo recurso dependente de diferenças de Safari/Firefox.

## Decisão

1. Completar o histórico Git: baixo esforço, corrige falsa ancestralidade, mas
   isoladamente mantém a publicação redundante.
2. Reconhecer HEAD já integrado e árvore sem pendências antes de publicar:
   esforço moderado, evita efeitos repetidos com evidência Git verificável.
3. Novos estados persistidos para execução/publicação: maior esforço e migração
   de contratos, útil para evolução futura, além do necessário para este defeito.

Escolhida a combinação 1 + 2, com preservação da resposta e aviso de erro real no
backend. Não se infere sucesso apenas do texto do modelo ou da existência de PR.

## Resultados locais

- Código original: quatro regressões Git falharam; backend perdeu a resposta em
  Markdown e invalidou a resposta JSON ao substituí-la pelo erro.
- Orquestrador: suíte inicial completa 187/187; após acrescentar os casos de
  histórico remoto insuficiente, squash e avanço da main, regressões finais
  45/45, sem falhas ou skips. Divergência real, rejeição de push e falha de teste
  continuam preservando código, resposta e status FAILED.
- Backend: suíte completa 147/147; integração adicional com H2/callback autenticado
  2/2. Callbacks repetidos preservam resumo, status, tokens e duração.
- Frontend: seis verificações Playwright aprovadas com os dados produzidos pela
  integração do backend, em Chromium desktop, iPhone 15 Pro e Pixel 7. Erros da
  configuração da fixture (browserName dentro de describe e interceptação de
  módulos `/src/api`) foram corrigidos antes da validação final. Lint/build aprovados.
- Scripts: `bash -n` e ShellCheck aprovaram os 20 arquivos; `git diff --check`
  aprovado. Nenhum teste exigiu modelo pago, campanha, deploy ou banco produtivo.

Para repetir a cadeia backend → frontend, defina `FINALIZATION_E2E_DETAIL` como um
arquivo temporário absoluto; execute `CodexReasoningSummaryIntegrationTest` e,
depois, `playwright test finalization.spec.ts`. As fixtures usam `sandbox.local`,
H2 e interceptação da API; não geram métricas comerciais.
