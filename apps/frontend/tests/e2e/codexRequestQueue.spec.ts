import { devices, expect, test, type Page } from '@playwright/test';
import type { CodexProfile, CodexStatus } from '../../src/lib/codex';

const timestamp = '2026-10-02T12:00:00Z';
const environment = 'test/dialogue-without-queue@main';
const row = (profile: CodexProfile, id: number, status: CodexStatus, env = environment) => ({
  id, profile, environment: env, model: 'gpt-6.1-sol', reasoningEffort: 'high', status,
  userMessage: `Pedido sintético ${id}`, requestTitle: `Pedido sintético ${id}`,
  responseText: status === 'COMPLETED' ? `Resposta sintética ${id}` : null,
  createdAt: new Date(Date.parse(timestamp) + id - 990400).toISOString()
});
const screen = (profile: CodexProfile) => profile === 'CHATGPT_CODEX' ? '/codex-chatgpt'
  : profile === 'CHATGPT_CODEX_MKT' ? '/codex-chatgpt-mkt' : '/codex-chatgpt-sandbox';
const server = (profile: CodexProfile) => ({
  rows: [row(profile, 990401, 'COMPLETED'), row(profile, 990402, 'RUNNING', 'test/other-environment@main'),
    row(profile, 990403, 'PENDING'), row('STANDARD', 990499, 'COMPLETED')],
  calls: [] as { path: string; method: string; profile: string | null }[], writes: 0
});

async function mockApi(page: Page, state: ReturnType<typeof server>) {
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const profile = url.searchParams.get('profile');
    state.calls.push({ path, method: request.method(), profile });
    // This UI must keep working without depending on the removed panel's endpoint.
    if (path === '/api/codex/requests/queue') return route.fulfill({ status: 503, json: { error: 'Fila indisponível' } });
    let json: unknown = [];
    if (path === '/api/account/read') json = { connected: true, status: 'connected', executable: true };
    if (path === '/api/environments/active') json = [{ id: 1, name: environment }];
    if (path === '/api/codex/models/active') json = [{ id: 1, modelName: 'gpt-6.1-sol' }];
    if (path === '/api/codex/requests/metrics') json = { day: { requestCount: 0, interactionCount: 0, durationMs: 0 } };
    const recent = state.rows.filter(item => item.profile === profile).sort((a, b) => b.id - a.id);
    if (path === '/api/codex/requests') {
      if (request.method() === 'POST') {
        state.writes++;
        const payload = request.postDataJSON();
        const created = { ...row(payload.profile, 990404, 'PENDING'), ...payload, requestTitle: payload.userMessage };
        state.rows.push(created);
        json = created;
      } else {
        // The paginated summaries do not contain dialogue messages or answers.
        json = { content: recent.map(({ id, profile, environment, model, reasoningEffort, status, requestTitle, createdAt }) =>
          ({ id, profile, environment, model, reasoningEffort, status, requestTitle, createdAt })),
        totalPages: 1, totalElements: recent.length };
      }
    }
    if (path === '/api/codex/requests/recent-dialogue') json = recent.slice(0, 10);
    if (/^\/api\/codex\/requests\/\d+$/.test(path)) json = state.rows.find(item => item.id === Number(path.split('/').at(-1)));
    return route.fulfill({ json });
  });
}

const dialogue = (page: Page) => page.getByLabel('Diálogo recente', { exact: true });
const assistant = (page: Page, id: number) => dialogue(page).locator(`article:has(a[href="/codex/requests/${id}"])`);
const expectNoQueue = async (page: Page) => {
  await expect(page.getByRole('region', { name: 'Fila de solicitações', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Atualizar fila', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
};

for (const deviceName of ['Desktop Chrome', 'Pixel 7']) {
  test.describe(`Diálogo sem quadro de fila — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile, hasTouch: device.hasTouch });

    for (const profile of ['CHATGPT_CODEX', 'CHATGPT_CODEX_MKT', 'CHATGPT_CODEX_SANDBOX'] as const) {
      test(`${profile}: preserva envio e estados entre computadores sem consultas extras de fila`, async ({ page, browser }, testInfo) => {
        const state = server(profile);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const otherContext = await browser.newContext(device);
        try {
          const other = await otherContext.newPage();
          other.on('pageerror', error => errors.push(error.message));
          for (const view of [page, other]) {
            await view.clock.install({ time: new Date(timestamp) });
            await mockApi(view, state);
            await view.goto(screen(profile));
            await expect(assistant(view, 990401)).toContainText('Resposta sintética 990401');
            await expect(assistant(view, 990402)).toContainText('Em execução');
            await expect(assistant(view, 990403)).toContainText('Pendente');
            await expect(assistant(view, 990499)).toHaveCount(0);
            await expectNoQueue(view);
          }
          expect(state.writes).toBe(0);
          await page.locator('textarea[required]').fill('Pedido enviado pelo primeiro computador');
          await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
          await expect(assistant(page, 990404)).toContainText('Pendente');
          await other.clock.fastForward(15_500);
          await expect(assistant(other, 990404)).toContainText('Pendente');
          await expect(dialogue(other)).toContainText('Pedido enviado pelo primeiro computador');
          expect(state.writes).toBe(1);

          state.rows[1].status = 'COMPLETED';
          state.rows[1].responseText = 'Resposta sincronizada do servidor';
          state.rows[2].status = 'RUNNING';
          for (const view of [page, other]) {
            await view.clock.fastForward(31_000);
            await expect(assistant(view, 990402)).toContainText('Resposta sincronizada do servidor');
            await expect(assistant(view, 990403)).toContainText('Em execução');
            await view.evaluate(() => {
              window.dispatchEvent(new Event('focus'));
              document.dispatchEvent(new Event('visibilitychange'));
            });
            await view.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
            await expectNoQueue(view);
            await expect(dialogue(view).locator('article')).toHaveCount(8);
          }
          await other.reload();
          await expect(assistant(other, 990403)).toContainText('Em execução');
          await expectNoQueue(other);
          await other.screenshot({ path: testInfo.outputPath('dialogue-without-queue.png'), animations: 'disabled' });
          expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(device.viewport.width);
          expect(state.calls.filter(call => call.path === '/api/codex/requests/queue')).toEqual([]);
          expect(state.calls.filter(call => call.path.endsWith('/recent-dialogue')).every(call => call.profile === profile)).toBe(true);
          expect(state.calls.filter(call => call.method !== 'GET')).toHaveLength(1);
          expect(errors).toEqual([]);
        } finally {
          await otherContext.close();
        }
      });
    }
  });
}
