import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { finishQuotaUsage, quotaWindows, readQuotaSnapshot, type QuotaUsage } from '../src/quotaUsage.js';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { buildJobPayload } from '../src/jobPayload.js';
import type { SandboxJob } from '../src/types.js';

const reset = Math.floor(Date.now() / 1000) + 86400;
const limits = (usedPercent = 6, resetsAt = reset) => ({ rateLimits: { limitId: 'codex', secondary: { usedPercent, resetsAt, windowDurationMins: 10080 } } });
function measurement(): QuotaUsage {
  return { version: 1, status: 'measuring', start: { capturedAt: new Date().toISOString(), accountKey: 'account-test', windows: quotaWindows(limits()) }, eventsObserved: 0, concurrentObserved: false, accountChanged: false, windows: [] };
}
for (const scenario of ['success', 'zero', 'reset', 'expired', 'decrease', 'missing', 'account', 'unknown', 'event-account'] as const) {
  test(`delta por janela: ${scenario}`, () => {
    const usage = measurement();
    const end = { capturedAt: new Date().toISOString(), accountKey: 'account-test', windows: quotaWindows(limits(scenario === 'zero' ? 6 : scenario === 'decrease' ? 2 : 8, scenario === 'reset' ? reset + 86400 : reset)) };
    if (scenario === 'expired') end.capturedAt = new Date(reset * 1000).toISOString();
    if (scenario === 'missing') end.windows = [];
    if (scenario === 'account') end.accountKey = 'other-account';
    if (scenario === 'unknown') delete usage.start.accountKey;
    if (scenario === 'event-account') usage.accountChanged = true;
    finishQuotaUsage(usage, end);
    assert.equal(usage.windows[0].consumedPercentagePoints, scenario === 'success' ? 2 : scenario === 'zero' ? 0 : undefined);
    assert.equal(usage.status, ['success', 'zero'].includes(scenario) ? 'estimated' : 'unavailable');
  });
}
test('buckets não são duplicados; payload inválido não vira zero', () => {
  assert.equal(quotaWindows({ ...limits(), rateLimitsByLimitId: { codex: limits().rateLimits, other: { primary: { usedPercent: 3, resetsAt: reset, windowDurationMins: 300 } } } }).length, 2);
  for (const usedPercent of [null, '6', NaN, -1, 101]) assert.deepEqual(quotaWindows({ rateLimits: { secondary: { usedPercent, resetsAt: reset, windowDurationMins: 10080 } } }), []);
});
function fixture(outcome: 'success' | 'failure' | 'cancel' | 'thread-failure' | 'unavailable' = 'success') {
  const events = new EventEmitter();
  const calls: string[] = [];
  let readCount = 0;
  const client = {
    isReady: () => true,
    onNotification(method: string, listener: (params: unknown) => void) { events.on(method, listener); return () => { events.off(method, listener); }; },
    async request(method: string) {
      calls.push(method);
      if (method === 'account/read') return { account: { type: 'chatgpt', email: 'synthetic@sandbox.local', planType: 'plus' } };
      if (method === 'account/rateLimits/read') {
        if (outcome === 'unavailable') throw new Error('SECRET_PROVIDER_ERROR');
        return limits(++readCount === 1 ? 6 : 8);
      }
      if (method === 'thread/start') {
        if (outcome === 'thread-failure') throw new Error('thread failed');
        return { thread: { id: 'quota-thread' } };
      }
      if (method === 'thread/archive') return {};
      if (method === 'turn/start') {
        events.emit('account/rateLimits/updated', limits(7));
        events.emit('thread/tokenUsage/updated', { threadId: 'quota-thread', tokenUsage: { last: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, total: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } } });
        if (outcome === 'cancel') throw new Error('CODEX_TURN_INTERRUPTED');
        events.emit('turn/completed', { threadId: 'quota-thread', turn: { status: outcome === 'failure' ? 'failed' : 'completed' } });
        return { turn: { id: 'quota-turn', status: outcome === 'failure' ? 'failed' : 'completed' } };
      }
      throw new Error(method);
    }
  };
  return { client, calls, events };
}
function job(profile: SandboxJob['profile']): SandboxJob {
  return { jobId: `quota-test-${profile}`, profile, status: 'RUNNING', taskDescription: 'Synthetic quota test', logs: [], interactions: [], interactionSequence: 0, timeoutCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
for (const profile of ['CHATGPT_CODEX', 'CHATGPT_CODEX_MKT', 'CHATGPT_CODEX_SANDBOX'] as const) {
  for (const outcome of ['success', 'failure', 'cancel', 'thread-failure', 'unavailable'] as const) {
    test(`coleta completa ${profile}: ${outcome}`, async () => {
      const { client, calls, events } = fixture(outcome);
      const task = job(profile);
      const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
      const run = (processor as any).runWithCodexAppServer(task, process.cwd(), 'gpt-6-astra');
      if (['failure', 'cancel', 'thread-failure'].includes(outcome)) await assert.rejects(run);
      else task.summary = await run;
      assert.equal(calls.filter((method) => method === 'account/rateLimits/read').length, 2);
      assert.equal(calls[1], 'account/rateLimits/read');
      assert.equal(task.quotaUsage?.status, outcome === 'unavailable' ? 'unavailable' : 'estimated');
      assert.equal(task.quotaUsage?.windows[0]?.consumedPercentagePoints, outcome === 'unavailable' ? undefined : 2);
      assert.ok(task.quotaUsage?.end);
      assert.equal(events.eventNames().length, 0);
      const payload = buildJobPayload(task);
      assert.ok(!JSON.stringify(payload).includes('synthetic@sandbox.local'));
      assert.ok(!JSON.stringify(payload).includes('SECRET_PROVIDER_ERROR'));
      if (outcome === 'success') {
        assert.equal(task.quotaUsage?.eventsObserved, 1);
        assert.equal(task.quotaUsage?.lastEvent?.windows[0].usedPercent, 7);
        assert.equal(task.totalTokens, 30);
        task.status = 'COMPLETED';
        if (profile === 'CHATGPT_CODEX_MKT' && process.env.QUOTA_E2E_PAYLOAD) await fs.writeFile(process.env.QUOTA_E2E_PAYLOAD, JSON.stringify(buildJobPayload(task)));
      }
    });
  }
}
test('concorrência observada em ambas solicitações, sem compartilhar snapshots', async () => {
  const { client } = fixture();
  const processor = new SandboxJobProcessor(undefined, 'gpt-6-astra', undefined, globalThis.fetch, client as any);
  const first = job('CHATGPT_CODEX'); const second = job('CHATGPT_CODEX_MKT');
  await Promise.all([first, second].map((task) => (processor as any).runWithCodexAppServer(task, process.cwd(), 'gpt-6-astra')));
  assert.equal(first.quotaUsage?.concurrentObserved, true);
  assert.equal(second.quotaUsage?.concurrentObserved, true);
  assert.notEqual(first.quotaUsage, second.quotaUsage);
});
test('falha de leitura de conta é opcional e não expõe erro', async () => {
  const snapshot = await readQuotaSnapshot({ request: async () => { throw new Error('secret'); } } as any);
  assert.deepEqual(snapshot.windows, []);
  assert.equal(snapshot.accountKey, undefined);
});

test('janela renovada não invalida outra janela ainda comparável', () => {
  const usage = measurement();
  usage.start.windows.push({ ...usage.start.windows[0], window: 'primary', windowDurationMins: 300 });
  finishQuotaUsage(usage, { ...usage.start, windows: [
    { ...usage.start.windows[1], resetsAt: reset + 300, usedPercent: 1 },
    { ...usage.start.windows[0], usedPercent: 8 }
  ] });
  assert.equal(usage.status, 'estimated');
  assert.equal(usage.windows[0].consumedPercentagePoints, 2);
  assert.equal(usage.windows[1].consumedPercentagePoints, undefined);
  assert.equal(usage.windows[1].reason, 'window_reset');
});
