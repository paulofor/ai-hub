import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { ExecutionTraceCollector, safeTraceUrl, sanitizeTraceText } from '../src/executionTrace.js';
import { CodexAppServerClient } from '../src/codexAppServerClient.js';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { createApp } from '../src/server.js';
import type { SandboxJob } from '../src/types.js';

test('preserva os estados, snapshots e ordem dos eventos sem duplicar planos', () => {
  const trace = new ExecutionTraceCollector();
  const plan = { plan: [{ step: 'Testar', status: 'inProgress' }, { step: 'Entregar', status: 'pending' }] };
  trace.addPlan('turn-1', plan);
  trace.addPlan('turn-1', plan);
  trace.item('turn-1', { id: 'command', type: 'commandExecution' }, false);
  trace.addPlan('turn-1', { plan: [{ step: 'Testar', status: 'completed' }, { step: 'Entregar', status: 'in_progress' }] });
  const snapshot = trace.snapshot()!;
  assert.equal(snapshot.plans.length, 2);
  assert.deepEqual(snapshot.plans[0].steps.map((step) => step.status), ['running', 'pending']);
  assert.deepEqual(snapshot.events.map((event) => event.kind), ['plan', 'command', 'plan']);
  assert.equal(snapshot.events[1].planId, snapshot.plans[0].id);
  assert.equal(snapshot.events[1].stepIndex, 0);
  snapshot.plans[0].steps[0].step = 'mutação';
  assert.equal(trace.snapshot()!.plans[0].steps[0].step, 'Testar');
});

test('exit code prevalece sobre completed; mede duração e ignora duplicata/start atrasado', () => {
  let now = 1_000;
  const trace = new ExecutionTraceCollector({ now: () => now });
  const item = { id: 'test', type: 'commandExecution', command: 'npm test' };
  trace.item('turn', item, false);
  now += 850;
  trace.item('turn', { ...item, status: 'completed', exitCode: 1, aggregatedOutput: 'Falhou' }, true);
  const expected = trace.snapshot();
  assert.equal(expected!.events[0].status, 'failed');
  assert.equal(expected!.events[0].durationMs, 850);
  assert.equal(expected!.events[0].durationSource, 'observed');
  trace.item('turn', { ...item, exitCode: 1 }, true);
  trace.item('turn', item, false);
  assert.deepEqual(trace.snapshot(), expected);
});

test('completion sem start usa duração apenas se o executor a informar', () => {
  const trace = new ExecutionTraceCollector();
  trace.item('turn', { id: 'test', type: 'commandExecution', exitCode: 0 }, true);
  trace.item('turn', { id: 'tool', type: 'dynamicToolCall', success: false, durationMs: 0 }, true);
  assert.equal(trace.snapshot()!.events[0].durationMs, undefined);
  assert.equal(trace.snapshot()!.events[1].durationMs, 0);
  assert.equal(trace.snapshot()!.events[1].status, 'failed');
});

test('resultado autoritativo atrasado preserva comando inicial e falha original do turno', () => {
  const trace = new ExecutionTraceCollector();
  trace.item('turn', { id: 'test', type: 'commandExecution', command: 'npm test' }, false);
  trace.finishTurn('turn', 'failed', 'stream disconnected');
  trace.item('turn', { id: 'test', type: 'commandExecution', exitCode: 0, aggregatedOutput: 'Teste aprovado' }, true);
  const snapshot = trace.snapshot()!;
  assert.equal(snapshot.events[0].status, 'completed');
  assert.equal(snapshot.events[0].details?.command, 'npm test');
  assert.equal(snapshot.events.find((event) => event.kind === 'turn')?.status, 'failed');
});

test('falha de turno interrompe somente a etapa ativa e preserva resultado em retomada', () => {
  const trace = new ExecutionTraceCollector();
  trace.addPlan('one', { plan: [{ step: 'Validar', status: 'inProgress' }, { step: 'Publicar', status: 'pending' }] });
  trace.item('one', { id: 'same-id', type: 'commandExecution' }, false);
  trace.finishTurn('one', 'failed', 'stream disconnected');
  trace.finishTurn('one', 'failed', 'duplicate');
  trace.retry('two');
  trace.addPlan('two', { plan: [{ step: 'Validar', status: 'completed' }] });
  trace.item('two', { id: 'same-id', type: 'commandExecution', exitCode: 0 }, true);
  const snapshot = trace.snapshot()!;
  assert.deepEqual(snapshot.plans[1].steps.map((step) => step.status), ['failed', 'pending']);
  assert.equal(snapshot.events.filter((event) => event.kind === 'command').length, 2);
  assert.equal(snapshot.events.filter((event) => event.label === 'Encerramento do turno').length, 1);
  assert.ok(snapshot.events.some((event) => event.label === 'Retomada da execução'));
});

test('não coleta reasoning, argumentos, diffs privados e eventos inválidos', () => {
  const trace = new ExecutionTraceCollector();
  for (const item of [null, {}, { id: 'raw', type: 'reasoning', summary: ['PUBLIC'], content: ['RAW'] }]) trace.item('turn', item, true);
  trace.addPlan('turn', { plan: [null, { step: 'INVALID', status: 'unknown' }] });
  assert.equal(trace.snapshot(), undefined);
  trace.item('turn', { id: 'tool', type: 'mcpToolCall', tool: 'consultar', arguments: { secret: 'PRIVATE_ARGUMENT' }, status: 'failed', error: { message: 'Erro público' } }, true);
  assert.equal(trace.snapshot()!.events[0].status, 'failed');
  assert.ok(!JSON.stringify(trace.snapshot()).includes('PRIVATE_ARGUMENT'));
});

test('sanitiza saídas e publica links seguros e arquivos da branch correta', () => {
  const trace = new ExecutionTraceCollector({ repoUrl: 'https://github.com/paulofor/ai-hub.git', repoPath: '/sandbox/repo', branch: 'feature/trace', secrets: ['SYNTHETIC_SECRET_VALUE'] });
  trace.item('turn', { id: 'cmd', type: 'commandExecution', command: 'curl -H "Authorization: Bearer SYNTHETIC_SECRET_VALUE" https://user:password@host.test',
    aggregatedOutput: 'token=ghp_syntheticTraceSecret0123456789 https://github.com/paulofor/ai-hub/pull/123 https://example.test/?token=private', exitCode: 0 }, true);
  trace.item('turn', { id: 'file', type: 'fileChange', changes: [{ path: '/sandbox/repo/apps/frontend/file.ts', diff: 'PRIVATE_DIFF' }, { path: '/etc/passwd' }] }, true);
  const result = JSON.stringify(trace.snapshot());
  assert.ok(!result.includes('SYNTHETIC_SECRET_VALUE'));
  assert.ok(!result.includes('ghp_syntheticTraceSecret'));
  assert.ok(!result.includes('PRIVATE_DIFF'));
  assert.ok(!result.includes('user:password'));
  assert.equal(trace.snapshot()!.events[0].evidence.length, 1);
  assert.equal(trace.snapshot()!.events[1].evidence[0].url, 'https://github.com/paulofor/ai-hub/blob/feature%2Ftrace/apps/frontend/file.ts');
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@host.test', 'https://host.test?api_key=secret']) assert.equal(safeTraceUrl(url), undefined);
  assert.ok(!sanitizeTraceText('AWS_SECRET_ACCESS_KEY=synthetic-secret').includes('synthetic-secret'));
});

test('limita histórico e texto mantendo a perda de dados explícita', () => {
  const trace = new ExecutionTraceCollector({ maxEvents: 3, maxPlans: 2 });
  for (let i = 0; i < 5; i++) trace.addPlan('turn', { plan: [{ step: `Etapa ${i}`, status: 'pending' }] });
  trace.item('turn', { id: 'long', type: 'commandExecution', aggregatedOutput: 'x'.repeat(10_000), exitCode: 0 }, true);
  const snapshot = trace.snapshot()!;
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.plans.length, 2);
  assert.equal(snapshot.droppedPlans, 3);
  assert.equal(snapshot.droppedEvents, 3);
  assert.ok(snapshot.events.at(-1)!.details!.output!.endsWith('[Trecho limitado]'));
});

test('JSON-RPC → polling preserva falha, retomada, evidências e resumo separado', async () => {
  const client = new CodexAppServerClient({ command: process.execPath, args: [path.resolve('tests/fixtures/fake-codex-app-server.cjs')],
    env: { FAKE_CODEX_APP_SERVER_MODE: 'execution-trace' }, autoRestart: false, logger: { info() {}, warn() {}, error() {} } });
  try {
    await client.start();
    const job: SandboxJob = { jobId: 'execution-trace-test', profile: 'CHATGPT_CODEX_MKT', taskDescription: 'Teste local do trace', repoUrl: 'https://github.com/paulofor/ai-hub.git', branch: 'main',
      status: 'RUNNING', logs: [], interactions: [], interactionSequence: 0, timeoutCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client);
    (processor as any).codexTransientTurnRetryDelayMs = 0;
    job.summary = await (processor as any).runWithCodexAppServer(job, process.cwd(), 'gpt-6-astra');
    job.status = 'COMPLETED';
    job.callbackSecret = 'synthetic-trace-callback';
    const app = createApp({ jobRegistry: new Map([[job.jobId, job]]), processor });
    const { body } = await request(app).get(`/jobs/${job.jobId}`).expect(200);
    const commands = body.executionTrace.events.filter((event: any) => event.kind === 'command');
    assert.deepEqual(commands.map((event: any) => event.status), ['failed', 'completed']);
    assert.equal(commands[1].durationMs, 1200);
    assert.equal(body.reasoningSummary, 'Resumo público validado por JSON-RPC.');
    assert.equal(body.summary, 'Resumo Codex App Server');
    assert.equal(body.callbackSecret, undefined);
    assert.ok(body.executionTrace.plans.some((plan: any) => plan.steps[0].status === 'failed'));
    assert.ok(commands[1].evidence.some((link: any) => link.url.includes('/actions/runs/123')));
    for (const privateText of ['OTHER_REQUEST', 'RAW_REASONING', 'PRIVATE_DIFF', 'ghp_syntheticTraceSecret']) assert.ok(!JSON.stringify(body.executionTrace).includes(privateText));
    assert.ok(!job.logs.join('\n').includes('RAW_REASONING_IGNORED'));
    if (process.env.EXECUTION_TRACE_E2E_PAYLOAD) await fs.writeFile(process.env.EXECUTION_TRACE_E2E_PAYLOAD, JSON.stringify(body));
  } finally { await client.stop(); }
});
