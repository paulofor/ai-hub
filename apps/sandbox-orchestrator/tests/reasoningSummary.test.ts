import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';
import request from 'supertest';
import { CodexAppServerClient } from '../src/codexAppServerClient.js';
import { createApp } from '../src/server.js';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { buildJobPayload } from '../src/jobPayload.js';
import type { SandboxJob } from '../src/types.js';

function makeJob(profile: SandboxJob['profile'] = 'CHATGPT_CODEX'): SandboxJob {
  return {
    jobId: `summary-test-${profile}`, profile, taskDescription: 'Validação local do resumo',
    status: 'RUNNING', logs: [], interactions: [], interactionSequence: 0, timeoutCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function appServerDouble(onTurn: (params: any, emit: (method: string, params: any) => void, attempt: number) => void) {
  const events = new EventEmitter();
  const calls: Array<{ method: string; params: any }> = [];
  let attempt = 0;
  const client = {
    isReady: () => true,
    onNotification: (method: string, listener: (params: unknown) => void) => {
      events.on(method, listener);
      return () => events.off(method, listener);
    },
    request: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'account/read') return { authMode: 'chatgpt', planType: 'plus' };
      if (method === 'thread/start') return { thread: { id: 'thread-summary' } };
      if (method === 'turn/start') {
        onTurn(params, (method, params) => events.emit(method, params), ++attempt);
        return { turn: { id: `turn-${attempt}` } };
      }
      if (method === 'thread/archive') return {};
      throw new Error(`Unexpected method: ${method}`);
    },
  };
  return { client, events, calls };
}

const scope = { threadId: 'thread-summary', turnId: 'turn-1' };
const delta = (text: string, summaryIndex = 0, itemId = 'reasoning-1') => ({ ...scope, itemId, summaryIndex, delta: text });
const reasoning = (summary: unknown, id = 'reasoning-1') => ({ ...scope, item: { type: 'reasoning', id, summary, content: ['RAW_CONTENT_MUST_NOT_BE_EXPOSED'] } });
const finish = (emit: (method: string, params: any) => void, extra = {}) => {
  emit('item/completed', { ...scope, ...extra, item: { type: 'agentMessage', id: 'answer', text: 'Resposta final preservada.' } });
  emit('turn/completed', { ...scope, ...extra, turn: { id: extra && 'turnId' in extra ? extra.turnId : scope.turnId, status: 'completed' } });
};

for (const profile of ['CHATGPT_CODEX', 'CHATGPT_CODEX_MKT', 'CHATGPT_CODEX_SANDBOX'] as const) {
  test(`solicita e coleta resumo com padrão none do provedor em ${profile}`, async () => {
    const { client, events, calls } = appServerDouble((params, emit) => {
      // A fixture só gera o resumo se o transporte habilitá-lo explicitamente.
      if (params.summary === 'auto') {
        emit('item/reasoning/summaryTextDelta', delta('Verifiquei '));
        emit('item/reasoning/summaryTextDelta', delta('a integração.'));
      }
      finish(emit);
    });
    const job = makeJob(profile);
    const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
    job.summary = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
    assert.equal(job.reasoningSummary, 'Verifiquei a integração.');
    assert.equal(job.summary, 'Resposta final preservada.');
    assert.equal(calls.find((call) => call.method === 'turn/start')?.params.summary, 'auto');
    const threadParams = calls.find((call) => call.method === 'thread/start')?.params;
    assert.equal(threadParams.config?.['tools.update_plan.enabled'], true);
    const threadAudit = JSON.parse(job.interactions.find((entry) => entry.direction === 'OUTBOUND' && entry.content.includes('thread/start'))!.content);
    assert.deepEqual(JSON.parse(threadAudit.transcript).params, threadParams);
    assert.equal(buildJobPayload(job).reasoningSummary, job.reasoningSummary);
    const audit = JSON.parse(job.interactions.find((entry) => entry.direction === 'OUTBOUND' && entry.content.includes('turn/start'))!.content);
    assert.equal(JSON.parse(audit.transcript).params.summary, 'auto');
    assert.equal(events.eventNames().length, 0);
  });
}

test('resumo final é autoritativo, separa partes/itens e não duplica eventos concluídos', async () => {
  const { client } = appServerDouble((_params, emit) => {
    emit('item/reasoning/summaryTextDelta', delta('Trecho provisório.'));
    emit('item/reasoning/summaryPartAdded', { ...scope, itemId: 'reasoning-1', summaryIndex: 1 });
    emit('item/reasoning/summaryTextDelta', delta('Segunda seção.', 1));
    emit('item/completed', reasoning(['Primeira seção definitiva.', 'Segunda seção.']));
    emit('item/completed', reasoning(['Primeira seção definitiva.', 'Segunda seção.']));
    emit('item/completed', reasoning(['Só no evento final.'], 'reasoning-2'));
    emit('item/reasoning/summaryTextDelta', delta('Terceira seção.', 0, 'reasoning-3'));
    finish(emit);
  });
  const job = makeJob();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  const response = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
  assert.equal(job.reasoningSummary, 'Primeira seção definitiva.\n\nSegunda seção.\n\nSó no evento final.\n\nTerceira seção.');
  assert.equal(response, 'Resposta final preservada.');
});

test('inclui os objetivos publicados pelo update_plan no resumo visível', async () => {
  const { client } = appServerDouble((_params, emit) => {
    emit('turn/plan/updated', {
      ...scope, plan: [{ step: 'Reproduzir o problema', status: 'inProgress' }],
    });
    assert.equal(buildJobPayload(job).reasoningSummary, '**Objetivos**\n- [ ] Reproduzir o problema');
    emit('turn/plan/updated', {
      ...scope,
      explanation: 'Plano atualizado após localizar a causa raiz.',
      plan: [
        { step: 'Reproduzir o problema', status: 'completed' },
        { step: 'Validar a correção', status: 'inProgress' },
      ],
    });
    emit('item/completed', reasoning(['A coleta do resumo continua preservada.']));
    finish(emit);
  });
  const job = makeJob();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
  assert.equal(
    job.reasoningSummary,
    '**Objetivos**\nPlano atualizado após localizar a causa raiz.\n- [x] Reproduzir o problema\n- [ ] Validar a correção\n\nA coleta do resumo continua preservada.',
  );
});

test('ignora outra thread, conteúdo bruto e eventos inválidos; ausência continua vazia', async () => {
  const { client } = appServerDouble((_params, emit) => {
    emit('item/reasoning/summaryTextDelta', { ...delta('OUTRA_SOLICITACAO'), threadId: 'thread-other' });
    emit('item/completed', { ...reasoning(['OUTRA_SOLICITACAO']), threadId: 'thread-other' });
    emit('turn/plan/updated', { ...scope, threadId: 'thread-other', plan: [{ step: 'OUTRA_SOLICITACAO', status: 'completed' }] });
    emit('turn/plan/updated', { ...scope, plan: [null, {}, { step: '' }] });
    emit('item/reasoning/textDelta', { ...scope, itemId: 'reasoning-1', delta: 'RAW_CONTENT' });
    emit('item/reasoning/summaryTextDelta', delta('invalid', -1));
    emit('item/reasoning/summaryTextDelta', { ...delta('invalid'), delta: {} });
    emit('item/completed', reasoning([null, {}, 42, { type: 'reasoning_text', text: 'RAW_CONTENT' }]));
    emit('item/completed', reasoning([]));
    finish(emit);
    emit('item/completed', { ...scope, threadId: 'thread-other', item: { type: 'agentMessage', text: 'OUTRA_RESPOSTA' } });
  });
  const job = makeJob();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  const result = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
  assert.equal(job.reasoningSummary, undefined);
  assert.equal(result, 'Resposta final preservada.');
});

test('mantém resumos separados por turno ao retomar falha transitória', async () => {
  const { client, calls } = appServerDouble((params, emit, attempt) => {
    const turnId = `turn-${attempt}`;
    if (params.summary === 'auto') emit('item/completed', { ...reasoning([`Resumo da tentativa ${attempt}.`]), turnId });
    if (attempt === 1) {
      emit('turn/completed', { ...scope, turn: { id: turnId, status: 'failed', error: { message: 'stream disconnected' } } });
    } else {
      finish(emit, { turnId });
    }
  });
  const job = makeJob();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  (processor as any).codexTransientTurnRetryDelayMs = 0;
  const result = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
  assert.equal(job.reasoningSummary, 'Resumo da tentativa 1.\n\nResumo da tentativa 2.');
  assert.equal(result, 'Resposta final preservada.');
  assert.equal(calls.filter((call) => call.method === 'turn/start' && call.params.summary === 'auto').length, 2);
});

test('coleta resumo com cliente JSON-RPC e processo App Server local', async () => {
  const client = new CodexAppServerClient({
    command: process.execPath, args: [path.resolve('tests/fixtures/fake-codex-app-server.cjs')],
    env: { FAKE_CODEX_APP_SERVER_MODE: 'reasoning-summary' }, autoRestart: false,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await client.start();
    const job = makeJob();
    const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client);
    job.summary = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
    assert.equal(job.reasoningSummary, 'Resumo público validado por JSON-RPC.');
    assert.equal(job.summary, 'Resumo Codex App Server');
    job.status = 'COMPLETED';
    job.callbackSecret = 'synthetic-callback-secret';
    const app = createApp({ jobRegistry: new Map([[job.jobId, job]]), processor });
    const response = await request(app).get(`/jobs/${job.jobId}`).expect(200);
    assert.equal(response.body.reasoningSummary, job.reasoningSummary);
    assert.equal(response.body.callbackSecret, undefined);
    if (process.env.REASONING_SUMMARY_E2E_PAYLOAD) {
      await fs.writeFile(process.env.REASONING_SUMMARY_E2E_PAYLOAD, JSON.stringify(response.body));
    }
  } finally {
    await client.stop();
  }
});

test('publica e atualiza update_plan via JSON-RPC até o polling HTTP', async () => {
  const client = new CodexAppServerClient({
    command: process.execPath, args: [path.resolve('tests/fixtures/fake-codex-app-server.cjs')],
    env: { FAKE_CODEX_APP_SERVER_MODE: 'update-plan' }, autoRestart: false,
    logger: { info() {}, warn() {}, error() {} },
  });
  const plans: unknown[] = [];
  const stop = client.onNotification('turn/plan/updated', (event) => plans.push(event));
  try {
    await client.start();
    const job = makeJob('CHATGPT_CODEX_MKT');
    const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client);
    job.summary = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
    job.status = 'COMPLETED';
    const app = createApp({ jobRegistry: new Map([[job.jobId, job]]), processor });
    const { body } = await request(app).get(`/jobs/${job.jobId}`).expect(200);
    assert.equal(plans.length, 2);
    assert.equal(body.reasoningSummary, '**Objetivos**\n- [x] Validar o checklist. Objetivo: acompanhar a execução.\n\nResumo público validado por JSON-RPC.');
    assert.equal(body.summary, 'Resumo Codex App Server');
    assert.equal(body.status, 'COMPLETED');
    assert.equal(body.quotaUsage.status, 'unavailable');
    assert.equal(job.timeoutCount, 0);
  } finally {
    stop();
    await client.stop();
  }
});

test('preserva resumo e plano recebidos quando o turno falha e remove os listeners', async () => {
  const { client, events } = appServerDouble((_params, emit) => {
    emit('turn/plan/updated', { ...scope, plan: [{ step: 'Validar a correção', status: 'inProgress' }] });
    emit('item/completed', reasoning(['Verificação antes da falha.']));
    emit('turn/completed', { ...scope, turn: { id: 'turn-1', status: 'failed', error: { message: 'quota exhausted' } } });
  });
  const job = makeJob();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  await assert.rejects((processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra'), /quota exhausted/);
  assert.equal(job.reasoningSummary, '**Objetivos**\n- [ ] Validar a correção\n\nVerificação antes da falha.');
  assert.equal(events.eventNames().length, 0);
});

test('aproveita itens incluídos no turn/completed mesmo sem item/completed', async () => {
  const { client } = appServerDouble((_params, emit) => {
    emit('turn/completed', { ...scope, turn: { id: 'turn-1', status: 'completed', items: [reasoning(['Resumo no turno.']).item] } });
  });
  const job = makeJob();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
  assert.equal(job.reasoningSummary, 'Resumo no turno.');
});

for (const model of ['gpt-6-astra', 'gpt-5.6-sol', 'o3', 'gpt-4.1-mini']) {
  test(`Responses API coleta resumos entre chamadas de ferramenta e respeita suporte de ${model}`, async () => {
    const job = makeJob('STANDARD');
    const calls: any[] = [];
    const openai = { responses: { create: async (params: any) => {
      calls.push(params);
      const turn = calls.length;
      return {
        id: `response-${turn}`,
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        output: [
          ...(params.reasoning?.summary === 'auto' ? [{
            type: 'reasoning', id: `rs-${turn}`,
            summary: [{ type: 'summary_text', text: `Resumo ${turn}.` }], encrypted_content: 'ENCRYPTED_NOT_A_SUMMARY',
          }] : []),
          ...(turn === 1 ? [{
            type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"apps/sandbox-orchestrator/package.json"}',
          }] : [{
            type: 'message', id: 'answer', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: 'Resposta final preservada.', annotations: [] }],
          }]),
        ],
      };
    } } };
    const processor = new SandboxJobProcessor(undefined, model, openai as any);
    const repoPath = path.resolve('../..');
    await (processor as any).runRunnerPreflight(job, repoPath);
    const result = await (processor as any).runCodexLoop(job, repoPath, model, openai);
    assert.equal(result, 'Resposta final preservada.');
    assert.equal(calls.length, 2);
    if (model === 'gpt-4.1-mini') {
      assert.equal(calls[0].reasoning, undefined);
      assert.equal(job.reasoningSummary, undefined);
    } else {
      assert.equal(calls[0].reasoning.summary, 'auto');
      assert.equal(calls[1].reasoning.summary, 'auto');
      assert.equal(job.reasoningSummary, 'Resumo 1.\n\nResumo 2.');
    }
    assert.equal(job.totalTokens, 24);
  });
}
