import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketingHubFlowInstruction, MARKETING_HUB_VALUE_FLOW_INSTRUCTION } from '../src/marketingFlowInstructions.js';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import type { SandboxJob, SandboxProfile } from '../src/types.js';

const marker = 'MARKETING_HUB_VALUE_FLOW_V2';
const target = { profile: 'CHATGPT_CODEX_MKT' as const, repoSlug: 'paulofor/marketing-hub' };

test('ativa a política somente pelo perfil e pela identidade exata do repositório', () => {
  for (const repoSlug of ['paulofor/marketing-hub', ' PAULOFOR/Marketing-Hub.git ']) {
    assert.equal(buildMarketingHubFlowInstruction({ ...target, repoSlug }), MARKETING_HUB_VALUE_FLOW_INSTRUCTION);
  }
  for (const repoUrl of ['https://github.com/paulofor/marketing-hub.git', 'https://github.com/paulofor/marketing-hub/']) {
    assert.equal(buildMarketingHubFlowInstruction({ profile: target.profile, repoUrl }), MARKETING_HUB_VALUE_FLOW_INSTRUCTION);
  }
  for (const repoSlug of ['paulofor/ai-hub', 'other/marketing-hub', 'paulofor/marketing-hub-copy', 'paulofor/marketing-hub/tree/main']) {
    assert.equal(buildMarketingHubFlowInstruction({ ...target, repoSlug, repoUrl: 'https://github.com/paulofor/marketing-hub.git' }), '');
  }
  for (const repoUrl of [undefined, '/tmp/marketing-hub', 'invalid', 'https://github.com.evil.test/paulofor/marketing-hub',
    'https://github.com/paulofor/marketing-hub/tree/main', 'file://github.com/paulofor/marketing-hub']) {
    assert.equal(buildMarketingHubFlowInstruction({ profile: target.profile, repoUrl }), '');
  }
  for (const profile of [undefined, 'STANDARD', 'CHATGPT_CODEX', 'CHATGPT_CODEX_SANDBOX'] as Array<SandboxProfile | undefined>) {
    assert.equal(buildMarketingHubFlowInstruction({ ...target, profile }), '');
  }
});

test('o payload real inclui a política uma vez sem depender de botão, produto ou histórico', () => {
  const processor = new SandboxJobProcessor();
  const inputFor = (metadata: Partial<SandboxJob>) => (processor as unknown as {
    buildCodexAppServerInput(job: SandboxJob): Array<Record<string, string>>;
  }).buildCodexAppServerInput({ jobId: 'fixture-value-flow', taskDescription: 'Destrave a atividade atual.', ...metadata } as SandboxJob);
  const input = inputFor(target);
  assert.equal(input.length, 1);
  const text = input[0].text;
  assert.equal(text.split(marker).length - 1, 1);
  assert.match(text, /Conduza o avanço autorizado do produto/);
  assert.ok(text.endsWith('Destrave a atividade atual.'));
  assert.match(text, /update_plan/);
  assert.match(text, /somente com JSON válido/);
  assert.match(text, /"impactoAumentoVendas"/);
  assert.match(text, /toda a investigação.*primeiro no ambiente local/);
  assert.match(text, /Não finalize como concluído enquanto houver workflow/);
  // An untrusted mention in the task must not activate another environment's policy.
  for (const metadata of [{ ...target, repoSlug: 'paulofor/ai-hub' }, { ...target, profile: 'CHATGPT_CODEX' as const }]) {
    const other = inputFor({ ...metadata, taskDescription: 'Investigue paulofor/marketing-hub e chainId=26.' })[0].text;
    assert.ok(!other.includes(marker));
  }
});

// Contract regressions derived from observed failures, not claims about an LLM's
// decisions or product sales. No paid inference or production writes are needed.
const cases: Array<[string, RegExp[]]> = [
  ['orientação sem execução ou aceite', [/preparação autorizada agora/, /aceite da saída/, /retorno ao processo pai/, /disponibilidade da próxima atividade/]],
  ['correção pontual sem prevenção', [/resolva o caso atual e previna/, /outro produto\/execução com identificadores diferentes/, /caminho antes válido/, /causa, evidência, mudança reutilizável/]],
  ['revisão repetida em referência encerrada', [/Experimento encerrado mantém suas provas/, /não renove parecer/, /novo ciclo e novo experimento/, /sem herdar autorizações vencidas/]],
  ['retentativa paga sem corrigir a causa', [/não há tarefa equivalente em andamento/, /replay suportado/, /sem nova inferência ou cobrança duplicada/, /falta de autorização para gasto futuro não impede preparação local/]],
  ['confusão entre prontidão e mercado', [/READY não comprova capacidade/, /Pouco tráfego não prova rejeição/, /compras líquidas conciliadas/, /valor é desconhecido, não zero/, /Separe testes, bots e simulações/]],
  ['autoridade, identidade e escopo', [/somente de análise continuam somente de análise/, /Sem produto definido/, /não são snapshots|não snapshots/, /Respeite STOP/, /Não recrute participantes/, /ação indispensável do usuário/]],
  ['produto parado e repasse manual entre agentes', [/Reduza o tempo até a próxima entrega aceita/, /remova esperas, repasses manuais e retrabalho/, /qual agente é responsável pelo próximo passo/, /o que ele recebe\/entrega/, /verifique aceite e continuação/]],
  ['decisão humana sem explicação acionável', [/visível assim que for identificada/, /destaque-a no campo orientacaoProximaAcao/, /qual produto e etapa estão parados/, /por que o modelo não pode resolvê-la/, /opções viáveis e recomendação justificada/, /prazo, custo\/limite e risco/, /ação exata do usuário/, /condição de retomada/]],
  ['parâmetro financeiro incompreensível ou sem local de resposta', [/traduza o termo técnico em linguagem simples/, /unidade \(% ou R\$\)/, /base do percentual/, /exemplo numérico identificado como fictício/, /modelo de resposta com espaço/, /Sua resposta à pendência/, /Preparar resposta à pendência/, /Enviar mensagem/, /Não invente um campo de cadastro/, /rascunho como valor persistido/, /confirme a decisão na fonte/]],
  ['margem confundida com lucro, padrão ou autorização de mídia', [/menor sobra aceitável por venda/, /incluindo entrega, taxas\/impostos e aquisição/, /ajuda a pagar custos fixos/, /não é lucro líquido/, /receita for positiva/, /descontos\/reembolsos/, /evite dupla contagem/, /R\$ 40, ou 40%/, /Não escolha um percentual padrão/, /faltarem custos reais/, /não devolva cálculos executáveis/, /não autoriza mídia/, /não resolve pendências técnicas/]],
  ['recomendação reenviada como autorização', [/não são decisões do usuário/, /aguarde resposta explícita antes das ações dependentes/, /continue o trabalho independente autorizado/, /Não peça nova autorização para passos já autorizados/, /simples reenvio da pergunta autoriza/, /sem duplicar tarefas ou custos/]],
  ['automação opaca ou continuação não comprovada', [/Diferencie execução em andamento, espera por decisão do usuário e bloqueio externo/, /fonte e o horário do estado/, /sem confirmar um mecanismo de execução ativo/, /como a retomada realmente ocorrerá/, /omita orientacaoProximaAcao/]],
];

for (const [scenario, requirements] of cases) {
  test(`preserva o contrato preventivo: ${scenario}`, () => {
    for (const requirement of requirements) assert.match(MARKETING_HUB_VALUE_FLOW_INSTRUCTION, requirement);
  });
}
