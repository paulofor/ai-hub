import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { buildMarketingHubCompletionReview, MARKETING_HUB_COMPLETION_REVIEW_MARKER } from '../src/marketingFlowReview.js';
import { buildJobPayload } from '../src/jobPayload.js';
import type { SandboxJob } from '../src/types.js';
import type { TracePlan } from '../src/executionTrace.js';

const initialSteps = [
  { step: 'Corrigir a continuidade e conferir a entrega aceita do produto.', status: 'running' as const },
  { step: 'Validar e publicar a passagem solicitada.', status: 'pending' as const },
];
// Public evidence distilled from #3276; no transcript, credentials or private reasoning.
const stalledResponse = JSON.stringify({ titulo: 'Orientação corrigida', comentario:
  'A janela foi salva. Corrigi o botão. O produto ainda aguarda o protótipo executável; nenhuma implementação está em execução.',
alterouCodigoRepositorio: true });
const acceptedResponse = JSON.stringify({ titulo: 'Passagem conferida', comentario:
  'Fixture local: implementação validada e saída aceita no contexto sintético. Não houve ação comercial real.',
alterouCodigoRepositorio: true });

type TurnAction = (context: {
  job: SandboxJob; turnId: string; emit: (method: string, params: Record<string, unknown>) => void;
}) => void;

async function runScenario(options: {
  task?: string; repoSlug?: string; profile?: SandboxJob['profile'];
  actions?: TurnAction[]; instant?: boolean; transientRetries?: number;
  reviewHook?: (input: string, job: SandboxJob) => void;
} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mkt-review-'));
  const repo = path.join(directory, 'source');
  await fs.mkdir(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  await fs.writeFile(path.join(repo, 'fixture.txt'), 'local only');
  git('add', '.'); git('commit', '-m', 'fixture');
  const job: SandboxJob = {
    jobId: path.basename(directory), repoUrl: repo, repoSlug: options.repoSlug ?? 'paulofor/marketing-hub',
    branch: 'main', profile: options.profile ?? 'CHATGPT_CODEX_MKT',
    taskDescription: options.task ?? 'Trabalhando produto sintético A: defini a janela, mas não sei como continuar.',
    status: 'PENDING', logs: [], interactions: [], interactionSequence: 0, timeoutCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const calls: Array<{ method: string; params: any }> = [];
  const emit = (method: string, params: Record<string, unknown>) => {
    for (const listener of listeners.get(method) ?? []) listener({ threadId: 'fixture-thread', ...params });
  };
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let turnCount = 0;
  const client = {
    isReady: () => true,
    onNotification(method: string, callback: (params: unknown) => void) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method)!.add(callback);
      return () => { listeners.get(method)!.delete(callback); };
    },
    async request(method: string, params: any) {
      calls.push({ method, params });
      if (method === 'account/read') return { authMode: 'chatgpt', planType: 'plus' };
      if (method === 'account/rateLimits/read') return { rateLimits: {} };
      if (method === 'thread/start') return { id: 'fixture-thread' };
      if (method === 'thread/archive') return {};
      assert.equal(method, 'turn/start');
      const index = turnCount++;
      // Prevent a broken harness from starting an unbounded review/retry loop.
      assert.ok(turnCount <= 5, 'unexpected extra turn');
      const turnId = `fixture-turn-${turnCount}`;
      if (index === 1) options.reviewHook?.(params.input[0].text, job);
      const action = options.actions?.[index];
      const deliver = () => {
        if (action) action({ job, turnId, emit });
        else {
          if (index === 0) {
            emit('turn/plan/updated', { turnId, plan: initialSteps });
            emit('turn/plan/updated', { turnId, plan: [{ step: 'Explicar o botão.', status: 'completed' }] });
          }
          emit('item/completed', { turnId, item: { id: `answer-${index}`, type: 'agentMessage', phase: 'final_answer',
            text: index === 0 ? stalledResponse : acceptedResponse } });
          emit('turn/completed', { turnId, status: 'completed' });
        }
      };
      if (options.instant) {
        return { turn: { id: turnId, status: 'completed', items: [{
          id: `instant-${index}`, type: 'agentMessage', phase: 'final_answer',
          text: index === 0 ? stalledResponse : acceptedResponse,
        }] } };
      }
      timers.push(setTimeout(deliver, 2));
      return { id: turnId };
    },
  };
  const processor = new SandboxJobProcessor(undefined, 'fixture-model', undefined, globalThis.fetch, client as any);
  // Local execution only: avoid Docker lifecycle/remote delivery; clone, trace,
  // turn handling, patch collection, payload and job status use the real processor.
  const internals = processor as any;
  internals.prepareWorkspace = async () => path.join(directory, 'workspace');
  internals.cleanupDockerHomologation = async () => {};
  internals.runRunnerPreflight = async () => {};
  internals.checkoutExistingWorkBranchForContext = async () => {};
  internals.resolveGithubAuth = () => ({ username: 'fixture', source: 'fixture' });
  internals.maybeCreatePullRequest = async () => false;
  internals.codexTransientTurnMaxAttempts = options.transientRetries ?? 1;
  internals.codexTransientTurnRetryDelayMs = 1;
  internals.sendCallback = async (completedJob: SandboxJob) => { callbacks.push(buildJobPayload(completedJob)); };
  const callbacks: SandboxJob[] = [];
  try {
    await processor.process(job);
    assert.equal(callbacks.length, 1);
    assert.equal(listeners.get('turn/completed')?.size, 0, 'listeners cleaned up');
    return { job, calls, payload: callbacks[0] };
  } finally {
    timers.forEach(clearTimeout);
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const finish = (text: string): TurnAction => ({ turnId, emit }) => {
  emit('item/completed', { turnId, item: { id: `${turnId}-answer`, type: 'agentMessage', phase: 'final_answer', text } });
  emit('turn/completed', { turnId, status: 'completed' });
};

test('regressão #3276: não encerra no botão corrigido, confere o plano original e entrega só a resposta revista', async () => {
  for (const task of ['Produto sintético A: salvei a janela e não sei como continuar.', 'Produto sintético B: tentei retomar a atividade e fiquei parado.']) {
    const { job, calls, payload } = await runScenario({ task, reviewHook: (input, activeJob) => {
      assert.equal(activeJob.status, 'RUNNING');
      assert.equal(activeJob.summary, undefined);
      assert.match(input, new RegExp(MARKETING_HUB_COMPLETION_REVIEW_MARKER));
      assert.match(input, /Corrigir a continuidade e conferir a entrega aceita/);
      assert.ok(input.includes(stalledResponse));
    } });
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.summary, acceptedResponse);
    assert.equal(payload.summary, acceptedResponse);
    const turns = calls.filter(c => c.method === 'turn/start');
    assert.equal(turns.length, 2);
    assert.ok(turns.every(c => c.params.threadId === 'fixture-thread'));
    assert.equal(calls.filter(c => c.method === 'thread/start').length, 1);
    assert.equal(calls.filter(c => c.method === 'thread/archive').length, 1);
    assert.equal(job.executionTrace?.events.filter(e => e.itemId === 'marketing-completion-review').length, 1);
    assert.equal(job.executionTrace?.events.filter(e => e.label === 'Retomada da execução').length, 0);
    if (process.env.MARKETING_REVIEW_E2E_DETAIL) {
      await fs.writeFile(process.env.MARKETING_REVIEW_E2E_DETAIL, JSON.stringify({
        id: 9903276, environment: job.repoSlug, profile: job.profile, model: 'fixture-model',
        status: job.status, prompt: task, responseText: job.summary,
        createdAt: job.createdAt, executionTrace: job.executionTrace,
      }));
    }
  }
});

test('conferência preserva análise, limites e entrega já comprovada sem um terceiro turno', async () => {
  for (const task of ['Somente analise; não altere o produto.', 'Corrija somente local; sem gastos, mídia ou publicação.', 'A entrega está integrada; confirme o resultado.']) {
    const { job, calls } = await runScenario({ task, actions: [finish(acceptedResponse), finish(acceptedResponse)], reviewHook: input => {
      assert.match(input, /pedidos somente de análise ou informação/);
      assert.match(input, /Preserve “somente local”, STOP, limites de IA\/mídia/);
      assert.match(input, /não autoriza gastos, campanhas, publicação comercial ou novo escopo/);
      assert.match(input, /sem refazer implementação, PR ou deploy/);
    } });
    assert.equal(job.summary, acceptedResponse);
    assert.equal(calls.filter(c => c.method === 'turn/start').length, 2);
  }
});

test('outros perfis e repositórios mantêm um único turno', async () => {
  for (const metadata of [{ profile: 'CHATGPT_CODEX' as const }, { repoSlug: 'paulofor/ai-hub' }, { repoSlug: 'other/marketing-hub' }]) {
    const { job, calls } = await runScenario(metadata);
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.summary, stalledResponse);
    assert.equal(calls.filter(c => c.method === 'turn/start').length, 1);
  }
});

test('falha na conferência não publica a resposta candidata como sucesso', async () => {
  const { job, payload } = await runScenario({ actions: [finish(stalledResponse), ({ turnId, emit }) => {
    emit('turn/completed', { turnId, status: 'failed', error: { message: 'fixture review failed' } });
  }] });
  assert.equal(job.status, 'FAILED');
  assert.match(job.error ?? '', /fixture review failed/);
  assert.equal(payload.summary, undefined);
});

test('conferência vazia não encerra com fallback de sucesso', async () => {
  const { job } = await runScenario({ actions: [finish(stalledResponse), ({ turnId, emit }) => {
    emit('turn/completed', { turnId, status: 'completed' });
  }] });
  assert.equal(job.status, 'FAILED');
  assert.match(job.error ?? '', /MARKETING_HUB_COMPLETION_REVIEW_EMPTY/);
  assert.equal(job.summary, undefined);
});

test('atualização pública e deltas sem resposta final não substituem o resultado da conferência', async () => {
  const { job } = await runScenario({ actions: [finish(stalledResponse), ({ turnId, emit }) => {
    emit('item/agentMessage/delta', { turnId, delta: 'Ainda estou conferindo.' });
    emit('item/completed', { turnId, item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Ainda estou conferindo.' } });
    emit('turn/completed', { turnId, status: 'completed' });
  }] });
  assert.equal(job.status, 'FAILED');
  assert.match(job.error ?? '', /MARKETING_HUB_COMPLETION_REVIEW_EMPTY/);
});

test('cancelamento depois da primeira resposta impede a conferência', async () => {
  const { job, calls } = await runScenario({ actions: [context => {
    finish(stalledResponse)(context); context.job.cancelRequested = true;
  }] });
  assert.equal(job.status, 'CANCELLED');
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 1);
});

test('cancelamento durante a conferência preserva CANCELLED e não publica o candidato', async () => {
  const { job, calls } = await runScenario({ actions: [finish(stalledResponse), context => {
    context.job.cancelRequested = true;
    context.emit('turn/completed', { turnId: context.turnId, status: 'completed' });
  }] });
  assert.equal(job.status, 'CANCELLED');
  assert.equal(job.summary, undefined);
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 2);
});

test('falha transitória inicial não consome a única conferência e mantém uso acumulado', async () => {
  const { job, calls } = await runScenario({ transientRetries: 2, actions: [({ turnId, emit }) => {
    emit('turn/completed', { turnId, status: 'failed', error: { message: 'stream disconnected before completion' } });
  }, context => {
    context.emit('thread/tokenUsage/updated', { turnId: context.turnId,
      tokenUsage: { total: { inputTokens: 30, outputTokens: 10, totalTokens: 40 } } });
    finish(stalledResponse)(context);
  }, context => {
    context.emit('thread/tokenUsage/updated', { turnId: context.turnId,
      tokenUsage: { total: { inputTokens: 60, outputTokens: 20, totalTokens: 80 } } });
    finish(acceptedResponse)(context);
  }] });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, acceptedResponse);
  assert.equal(job.totalTokens, 80);
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 3);
  assert.equal(job.executionTrace?.events.filter(e => e.itemId === 'marketing-completion-review').length, 1);
});

test('falha transitória durante a conferência retoma a mesma fase sem aceitar o resultado anterior', async () => {
  const { job, calls } = await runScenario({ transientRetries: 2, actions: [finish(stalledResponse), ({ turnId, emit }) => {
    emit('turn/completed', { turnId, status: 'failed', error: { message: 'stream disconnected before completion' } });
  }, finish(acceptedResponse)] });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, acceptedResponse);
  const turns = calls.filter(c => c.method === 'turn/start');
  assert.equal(turns.length, 3);
  assert.match(turns[2].params.input[0].text, /conferência do resultado/);
  assert.ok(turns.every(c => c.params.threadId === 'fixture-thread'));
});

test('eventos atrasados do primeiro turno ou de outra thread não encerram nem contaminam a conferência', async () => {
  const { job } = await runScenario({ actions: [finish(stalledResponse), context => {
    const { emit } = context;
    emit('turn/completed', { turnId: 'fixture-turn-1', status: 'failed', error: { message: 'stale failure' } });
    emit('error', { threadId: 'other-thread', message: 'foreign failure' });
    finish(acceptedResponse)(context);
    emit('item/completed', { turnId: 'fixture-turn-1', item: { id: 'stale-answer', type: 'agentMessage', text: stalledResponse } });
  }] });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, acceptedResponse);
  assert.ok(!job.executionTrace?.events.some(e => e.itemId === 'stale-answer'));
});

test('snapshot terminal imediato também passa pela conferência', async () => {
  const { job, calls } = await runScenario({ instant: true });
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, acceptedResponse);
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 2);
});

test('primeiro checklist sobrevive ao limite de planos e não usa o último escopo reduzido', async () => {
  const { job } = await runScenario({ actions: [context => {
    context.emit('turn/plan/updated', { turnId: context.turnId, plan: initialSteps });
    for (let index = 0; index < 85; index++) context.emit('turn/plan/updated', {
      turnId: context.turnId, plan: [{ step: `Só orientação ${index}`, status: 'completed' }],
    });
    finish(stalledResponse)(context);
  }, finish(acceptedResponse)], reviewHook: input => {
    assert.match(input, /Corrigir a continuidade e conferir a entrega aceita/);
    assert.doesNotMatch(input, /Só orientação 84/);
  } });
  assert.equal(job.status, 'COMPLETED');
  assert.ok((job.executionTrace?.droppedPlans ?? 0) > 0);
});

test('contexto da conferência é limitado, sanitizado e usa apenas checklist e resposta pública', () => {
  const plan: TracePlan = { id: 'plan', turnId: 't', receivedAt: '2026-10-08T00:00:00Z',
    steps: [{ step: 'secret-fixture-value', status: 'pending' }] };
  const text = buildMarketingHubCompletionReview(plan, `Bearer abcdefgh ${'x'.repeat(20000)}`, ['secret-fixture-value']);
  assert.doesNotMatch(text, /secret-fixture-value|abcdefgh/);
  assert.match(text, /Trecho limitado/);
  assert.ok(text.length < 21000);
  assert.match(buildMarketingHubCompletionReview(undefined, 'ok'), /Não registrado/);
});
