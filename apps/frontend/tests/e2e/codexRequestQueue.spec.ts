import { devices, expect, test, type Page } from '@playwright/test';

type Profile = 'CHATGPT_CODEX' | 'CHATGPT_CODEX_MKT' | 'CHATGPT_CODEX_SANDBOX';
type Row = ReturnType<typeof row>;
const timestamp = '2026-10-01T12:00:00Z';
const environment = 'test/queue@main';
const row = (profile: Profile, id: number, status = 'PENDING', env = environment) => ({
  id, profile, environment: env, model: 'gpt-6.1-sol', reasoningEffort: 'high', status,
  userMessage: `Pedido sintético ${id}`, requestTitle: `Pedido sintético ${id}`, createdAt: timestamp
});
const screen = (profile: Profile) => profile === 'CHATGPT_CODEX' ? '/codex-chatgpt'
  : profile === 'CHATGPT_CODEX_MKT' ? '/codex-chatgpt-mkt' : '/codex-chatgpt-sandbox';

function server(initial: Row[]) {
  return { rows: [...initial], writes: 0, failQueue: false, failHistory: false, queueProfiles: [] as string[] };
}

async function mockApi(page: Page, state: ReturnType<typeof server>) {
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let json: unknown = [];
    if (path === '/api/account/read') json = { connected: true, status: 'connected', executable: true };
    if (path === '/api/environments/active') json = [{ id: 1, name: environment }];
    if (path === '/api/codex/models/active') json = [{ id: 1, modelName: 'gpt-6.1-sol' }];
    if (path === '/api/codex/requests/metrics') json = { day: { requestCount: 0, interactionCount: 0, durationMs: 0 } };
    if (path === '/api/codex/requests/queue') {
      const profile = url.searchParams.get('profile')!;
      state.queueProfiles.push(profile);
      if (state.failQueue) return route.fulfill({ status: 503, json: { error: 'Falha sintética de consulta' } });
      let pendingPosition = 0;
      json = { profile, updatedAt: timestamp, requests: state.rows
        .filter(item => item.profile === profile && (item.status === 'PENDING' || item.status === 'RUNNING'))
        .map(item => ({ ...item, queuePosition: item.status === 'PENDING' ? ++pendingPosition : 0 })) };
    }
    if (path === '/api/codex/requests') {
      if (request.method() === 'POST') {
        state.writes++;
        const payload = request.postDataJSON();
        const created = { ...row(payload.profile, 990403), ...payload, requestTitle: payload.userMessage };
        state.rows.push(created);
        json = created;
      } else {
        if (state.failHistory) return route.fulfill({ status: 503, json: { error: 'Falha sintética do histórico' } });
        // Active jobs are intentionally absent from both legacy history queries.
        json = { content: [], totalPages: 0, totalElements: 0 };
      }
    }
    if (/^\/api\/codex\/requests\/\d+$/.test(path)) json = state.rows.find(item => item.id === Number(path.split('/').at(-1)));
    return route.fulfill({ json });
  });
}

for (const deviceName of ['Desktop Chrome', 'Pixel 7']) {
  test.describe(deviceName, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile, hasTouch: device.hasTouch });

    for (const profile of ['CHATGPT_CODEX', 'CHATGPT_CODEX_MKT', 'CHATGPT_CODEX_SANDBOX'] as const) {
      test(`${profile}: dois computadores compartilham a fila sem storage local`, async ({ page, browser }, testInfo) => {
        const state = server([row(profile, 990401, 'RUNNING', 'test/other-environment@main'), row(profile, 990402),
          row('CHATGPT_CODEX_MKT', 990499, 'COMPLETED')]);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(profileName => {
          localStorage.setItem(`ai-hub:codex-chat-conversation:${profileName}`, JSON.stringify([
            { id: 'stale-local', role: 'assistant', content: 'Cache local antigo', requestId: 900999,
              status: 'PENDING', createdAt: '2020-01-01T00:00:00Z' }
          ]));
          localStorage.setItem(`ai-hub:codex-chat-hidden-requests:${profileName}`, '[990401]');
        }, profile);
        const otherContext = await browser.newContext(device);
        try {
          const other = await otherContext.newPage();
          other.on('pageerror', error => errors.push(error.message));
          await other.clock.install();
          await mockApi(page, state);
          await mockApi(other, state);
          await page.goto(screen(profile));
          await other.goto(screen(profile));
          const queues = [page, other].map(tab => tab.getByRole('region', { name: 'Fila de solicitações', exact: true }));
          for (const queue of queues) {
            await expect(queue.getByRole('heading', { name: 'Em execução (1)', exact: true })).toBeVisible();
            await expect(queue.getByRole('heading', { name: 'Pendentes (1)', exact: true })).toBeVisible();
            await expect(queue.getByRole('link')).toHaveCount(2);
            await expect(queue).toContainText('test/other-environment@main');
            await expect(queue).not.toContainText('#900999');
            await expect(queue).not.toContainText('#990499');
          }
          expect(state.writes).toBe(0);
          await page.locator('textarea[required]').fill('Pedido enviado pelo primeiro computador');
          await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
          await expect(queues[0].getByRole('link', { name: 'Solicitação #990403', exact: true })).toBeVisible();
          await other.clock.fastForward(15_500);
          await expect(queues[1].getByRole('link', { name: 'Solicitação #990403', exact: true })).toBeVisible();
          await expect(queues[1]).toContainText('Pendente · posição 2');
          expect(state.writes).toBe(1);
          state.rows[0].status = 'COMPLETED';
          state.rows[1].status = 'RUNNING';
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await other.clock.fastForward(15_500);
          for (const queue of queues) {
            await expect(queue.getByRole('link')).toHaveCount(2);
            await expect(queue.getByRole('link', { name: 'Solicitação #990401', exact: true })).toHaveCount(0);
            await expect(queue.getByRole('heading', { name: 'Pendentes (1)', exact: true })).toBeVisible();
            await expect(queue).toContainText('Pendente · posição 1');
          }
          await other.reload();
          await expect(queues[1].getByRole('link')).toHaveCount(2);
          await queues[1].scrollIntoViewIfNeeded();
          const box = await queues[1].boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(device.viewport.width + 1);
          await other.screenshot({ path: testInfo.outputPath('queue.png'), animations: 'disabled' });
          expect(state.queueProfiles.every(value => value === profile)).toBe(true);
          expect(errors).toEqual([]);
        } finally {
          await otherContext.close();
        }
      });
    }

    test('fila inclui todos os ativos e usa a posição recebida do backend', async ({ page }) => {
      const profile = 'CHATGPT_CODEX_MKT';
      await mockApi(page, server([]));
      await page.route('**/api/codex/requests/queue?**', route => route.fulfill({ json: {
        profile, updatedAt: timestamp, requests: Array.from({ length: 26 }, (_, index) => ({
          ...row(profile, 990500 + index), queuePosition: index + 41
        }))
      } }));
      await page.goto(screen(profile));
      const queue = page.getByRole('region', { name: 'Fila de solicitações', exact: true });
      await expect(queue.getByRole('link')).toHaveCount(26);
      await expect(queue).toContainText('Pendente · posição 41');
      await expect(queue).toContainText('Pendente · posição 66');
      await expect(queue.getByRole('heading', { name: 'Pendentes (26)', exact: true })).toBeVisible();
    });

    test('falha preserva a última consulta e a fila recupera mesmo com histórico indisponível', async ({ page }) => {
      const state = server([row('CHATGPT_CODEX', 990401, 'RUNNING')]);
      await mockApi(page, state);
      await page.goto('/codex-chatgpt');
      const queue = page.getByRole('region', { name: 'Fila de solicitações', exact: true });
      await expect(queue.getByRole('link')).toHaveCount(1);
      state.failQueue = true;
      await queue.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
      await expect(queue.getByRole('alert')).toContainText('A última consulta foi preservada.');
      await expect(queue.getByRole('link')).toHaveCount(1);
      state.failQueue = false;
      state.failHistory = true;
      state.rows.push(row('CHATGPT_CODEX', 990402));
      await queue.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
      await expect(queue.getByRole('alert')).toHaveCount(0);
      await expect(queue.getByRole('link')).toHaveCount(2);
      await expect(queue).toContainText('Consulta do servidor:');
      expect(state.writes).toBe(0);
    });

    test('falha na primeira leitura não informa falsamente uma fila vazia', async ({ page }) => {
      const state = server([]);
      state.failQueue = true;
      await mockApi(page, state);
      await page.goto('/codex-chatgpt');
      const queue = page.getByRole('region', { name: 'Fila de solicitações', exact: true });
      await expect(queue.getByRole('alert')).toContainText('Falha sintética de consulta');
      await expect(queue).not.toContainText('Nenhuma solicitação');
      state.failQueue = false;
      await queue.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
      await expect(queue).toContainText('Nenhuma solicitação pendente.');
      await expect(queue.getByRole('alert')).toHaveCount(0);
    });
  });
}
