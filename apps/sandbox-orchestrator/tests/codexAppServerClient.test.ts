import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { CodexAppServerClient } from '../src/codexAppServerClient.js';

const fixturePath = path.resolve('tests/fixtures/fake-codex-app-server.cjs');
const silentLogger = { info() {}, warn() {}, error() {} };

function createClient(extraEnv: NodeJS.ProcessEnv = {}, requestTimeoutMs = 2000): CodexAppServerClient {
  return new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    env: extraEnv,
    requestTimeoutMs,
    restartBackoffMs: 20,
    maxRestartAttempts: 1,
    autoRestart: false,
    logger: silentLogger,
  });
}

test('inicializa via initialize antes de requests e envia initialized', async () => {
  const client = createClient();
  await client.start();

  assert.equal(client.isReady(), true);
  assert.equal(client.health().status, 'ready');
  const account = await client.request<{ authMode: string; planType: string }>('account/read', { refreshToken: false });
  assert.deepEqual(account, { authMode: 'chatgpt', planType: 'plus' });

  await client.stop();
});

test('correlaciona respostas fora de ordem por id', async () => {
  const client = createClient();
  await client.start();

  const first = client.request<{ method: string }>('test/out-of-order-a');
  const second = client.request<{ method: string }>('test/out-of-order-b');

  assert.deepEqual(await second, { method: 'test/out-of-order-b' });
  assert.deepEqual(await first, { method: 'test/out-of-order-a' });

  await client.stop();
});

test('distribui notificações sem confundir com responses', async () => {
  const client = createClient();
  const received = new Promise<unknown>((resolve) => {
    client.onNotification('account/updated', resolve);
  });

  await client.start();
  assert.deepEqual(await received, { authMode: 'chatgpt', planType: 'plus' });
  assert.equal(client.pendingRequestCountForTests(), 0);

  await client.stop();
});

test('rejeita promises pendentes quando o processo termina', async () => {
  const client = createClient({}, 1000);
  await client.start();
  const pending = assert.rejects(client.request('test/never'), /parado|encerrou/);

  await client.stop();
  await pending;
});

test('marca estado degradado quando o processo encerra durante initialize', async () => {
  const client = createClient({ FAKE_CODEX_APP_SERVER_MODE: 'exit-on-initialize' }, 2000);

  await assert.rejects(client.start());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(client.health().status, 'degraded');
});


test('trata notificações error do Codex App Server sem derrubar o processo', async () => {
  const client = createClient({}, 1000);
  const received = new Promise<unknown>((resolve) => {
    client.onNotification('error', resolve);
  });

  await client.start();
  assert.deepEqual(await client.request('test/error-notification'), { ok: true });
  assert.deepEqual(await received, { error: { message: 'fake codex app server error' }, willRetry: false });
  assert.equal(client.isReady(), true);

  await client.stop();
});
