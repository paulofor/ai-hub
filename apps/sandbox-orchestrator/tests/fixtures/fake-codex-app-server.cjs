const readline = require('node:readline');

const mode = process.env.FAKE_CODEX_APP_SERVER_MODE || 'normal';
const rl = readline.createInterface({ input: process.stdin });
let updatePlanEnabled = false;
let traceAttempts = 0;

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
    updatePlanEnabled = message.params?.config?.['tools.update_plan.enabled'] === true;
    send({ id: message.id, result: { id: 'thread-123' } });
    return;
  }
  if (message.method === 'turn/start') {
    if (mode === 'execution-trace') {
      const attempt = ++traceAttempts;
      const turnId = `turn-trace-${attempt}`;
      const scope = { threadId: message.params.threadId, turnId };
      const emit = (method, params) => send({ method, params: { ...scope, ...params } });
      const plan = (status) => emit('turn/plan/updated', { plan: [
        { step: 'Validar o fluxo completo', status }, { step: 'Revisar a entrega', status: 'pending' },
      ] });
      send({ id: message.id, result: { turn: { id: turnId } } });
      plan('inProgress');
      emit('item/started', { item: { id: 'test-command', type: 'commandExecution', command: 'npm test', status: 'inProgress' } });
      setTimeout(() => {
        const item = { id: 'test-command', type: 'commandExecution', command: 'npm test', status: 'completed',
          exitCode: attempt === 1 ? 1 : 0, durationMs: 1200,
          aggregatedOutput: attempt === 1 ? 'Teste falhou. token=ghp_syntheticTraceSecret0123456789' : '12 testes aprovados. https://github.com/paulofor/ai-hub/actions/runs/123' };
        emit('item/completed', { item });
        emit('item/completed', { item }); // Retransmission cannot duplicate the result.
        emit('item/completed', { threadId: 'other-thread', item: { ...item, aggregatedOutput: 'OTHER_REQUEST' } });
        if (attempt === 1) {
          emit('turn/completed', { turn: { id: turnId, status: 'failed', error: { message: 'stream disconnected' } } });
          return;
        }
        emit('item/started', { item: { id: 'file-change', type: 'fileChange', status: 'inProgress', changes: [{ path: 'apps/frontend/src/lib/executionTrace.ts' }] } });
        emit('item/completed', { item: { id: 'file-change', type: 'fileChange', status: 'completed', changes: [{ path: 'apps/frontend/src/lib/executionTrace.ts', diff: 'PRIVATE_DIFF_IGNORED' }] } });
        emit('item/completed', { item: { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'Validei os testes locais e a recuperação da execução.' } });
        plan('completed');
        emit('item/completed', { item: { id: 'reasoning', type: 'reasoning', summary: ['Resumo público validado por JSON-RPC.'], content: ['RAW_REASONING_IGNORED'] } });
        emit('item/completed', { item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Resumo Codex App Server' } });
        emit('turn/completed', { turn: { id: turnId, status: 'completed' } });
      }, 5);
      return;
    }
    const sendTurnStarted = () => send({ id: message.id, result: { id: 'turn-123' } });
    if (mode === 'slow-turn-start') {
      setTimeout(sendTurnStarted, 80);
    } else {
      sendTurnStarted();
    }
    if (mode === 'update-plan' && updatePlanEnabled) {
      for (const status of ['inProgress', 'completed']) {
        send({ method: 'turn/plan/updated', params: {
          threadId: message.params.threadId, turnId: 'turn-123', explanation: null,
          plan: [{ step: 'Validar o checklist e acompanhar a execução.', status }],
        } });
      }
    }
    if (['reasoning-summary', 'update-plan'].includes(mode) && message.params?.summary === 'auto') {
      setTimeout(() => send({ method: 'item/completed', params: {
        threadId: message.params.threadId, turnId: 'turn-123',
        item: { type: 'reasoning', id: 'reasoning-123', summary: ['Resumo público validado por JSON-RPC.'], content: [] },
      } }), 3);
    }
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
  if (message.method === 'test/retrying-error-notification') {
    send({ id: message.id, result: { ok: true } });
    setTimeout(() => send({
      method: 'error',
      params: {
        error: { message: 'Reconnecting... 1/5' },
        willRetry: true,
        threadId: 'thread-123',
        turnId: 'turn-123',
      },
    }), 5);
    return;
  }
  if (message.method === 'test/never') {
    return;
  }
  send({ id: message.id, result: { ok: true, method: message.method } });
});
