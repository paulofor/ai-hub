const readline = require('node:readline');

const mode = process.env.FAKE_CODEX_APP_SERVER_MODE || 'normal';
const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (mode === 'exit-on-initialize') {
      process.exit(2);
      return;
    }
    send({ id: message.id, result: { protocolVersion: 'codex-app-server-test' } });
    return;
  }
  if (message.method === 'initialized') {
    send({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'plus' } });
    return;
  }
  if (message.method === 'account/read') {
    send({ id: message.id, result: { authMode: 'chatgpt', planType: 'plus' } });
    return;
  }
  if (message.method === 'account/login/start') {
    send({ id: message.id, result: { type: message.params?.type || 'chatgptDeviceCode', loginId: 'login-123', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234', interval: 5 } });
    return;
  }
  if (message.method === 'account/login/cancel') {
    send({ id: message.id, result: { cancelled: true, loginId: message.params?.loginId } });
    return;
  }
  if (message.method === 'account/logout') {
    send({ id: message.id, result: { disconnected: true } });
    return;
  }
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { id: 'thread-123' } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { id: 'turn-123' } });
    setTimeout(() => send({ method: 'item/agentMessage/delta', params: { threadId: message.params?.threadId, turnId: 'turn-123', delta: 'Resumo Codex App Server' } }), 5);
    setTimeout(() => send({ method: 'turn/completed', params: { threadId: message.params?.threadId, turnId: 'turn-123', status: 'completed' } }), 10);
    return;
  }
  if (message.method === 'test/out-of-order-a') {
    setTimeout(() => send({ id: message.id, result: { method: message.method } }), 30);
    return;
  }
  if (message.method === 'test/out-of-order-b') {
    setTimeout(() => send({ id: message.id, result: { method: message.method } }), 5);
    return;
  }
  if (message.method === 'test/error-notification') {
    send({ id: message.id, result: { ok: true } });
    setTimeout(() => send({ method: 'error', params: { error: { message: 'fake codex app server error' }, willRetry: false } }), 5);
    return;
  }
  if (message.method === 'test/never') {
    return;
  }
  send({ id: message.id, result: { ok: true, method: message.method } });
});
