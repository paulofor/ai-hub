import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

const generated = process.env.QUOTA_E2E_DETAIL;
const fixture = generated ? JSON.parse(readFileSync(generated, 'utf8')) : {
  id: 990052, environment: 'sandbox.local', model: 'gpt-6-astra', status: 'COMPLETED',
  prompt: 'Teste de cota', createdAt: '2026-09-16T12:00:00Z',
  quotaUsage: JSON.stringify({ status: 'estimated', start: { capturedAt: '2026-09-16T12:00:00Z' }, end: { capturedAt: '2026-09-16T12:01:00Z' }, windows: [
    { limitId: 'codex', windowDurationMins: 10080, resetsAt: 2000000000, usedPercent: 6, finalUsedPercent: 8, consumedPercentagePoints: 2 }
  ] })
};
for (const deviceName of ['Desktop Chrome', 'iPhone 15 Pro']) {
  test.describe(`Cota — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });
    for (const [profile, url] of [['CHATGPT_CODEX', '/codex-chatgpt'], ['CHATGPT_CODEX_MKT', '/codex-chatgpt-mkt'], ['CHATGPT_CODEX_SANDBOX', '/codex-chatgpt-sandbox']]) {
      test(`histórico e detalhe ${profile}`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const detail = { ...fixture, profile };
        await page.route('**/api/**', (route) => {
          const path = new URL(route.request().url()).pathname;
          if (!path.startsWith('/api/')) return route.continue();
          if (path === '/api/account/read') return route.fulfill({ json: { connected: true, status: 'connected', executable: true } });
          if (path === `/api/codex/requests/${detail.id}`) return route.fulfill({ json: detail });
          if (path.endsWith('/previous')) return route.fulfill({ status: 404, json: {} });
          if (path === '/api/codex/requests') return route.fulfill({ json: { content: [detail], totalElements: 1, totalPages: 1 } });
          if (path.endsWith('/metrics')) return route.fulfill({ json: { day: { requestCount: 1, interactionCount: 1, durationMs: 1000 } } });
          return route.fulfill({ json: [] });
        });
        await page.goto(url);
        const quota = page.getByTestId('codex-quota-usage');
        await expect(quota).toContainText('2 p.p. (estimado)');
        await expect(quota).toContainText('semanal');
        await page.getByRole('link', { name: 'Abrir detalhes' }).click();
        await expect(quota).toContainText('2 p.p.');
        await expect(quota).toContainText('6% → 8%');
        await expect(quota).toContainText('Não é custo em dinheiro.');
        await expect(quota).toContainText('Leitura inicial:');
        await page.screenshot({ path: testInfo.outputPath('quota-detail.png'), fullPage: true });
        await page.reload();
        await expect(quota).toContainText('2 p.p.');
        expect(errors).toEqual([]);
      });
    }
    test('legado, medição em andamento, zero, renovação e dado inválido', async ({ page }) => {
      const original = JSON.parse(fixture.quotaUsage);
      let raw: string | undefined;
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith('/api/')) return route.continue();
        return route.fulfill({ json: path.endsWith(`/${fixture.id}`) ? { ...fixture, profile: 'CHATGPT_CODEX', quotaUsage: raw } : [] });
      });
      for (const [value, expected] of [
        [undefined, 'Indisponível'],
        [JSON.stringify({ ...original, status: 'measuring', end: undefined, windows: [] }), 'Em medição'],
        [JSON.stringify({ ...original, windows: [{ ...original.windows[0], consumedPercentagePoints: 0 }] }), '0 p.p.'],
        [JSON.stringify({ ...original, windows: [{ ...original.windows[0], consumedPercentagePoints: undefined, reason: 'window_reset' }] }), 'Cota renovada ou janela alterada'],
        ['{"windows":[null]}', 'Indisponível']
      ]) {
        raw = value;
        await page.goto(`/codex/requests/${fixture.id}`);
        await expect(page.getByTestId('codex-quota-usage')).toContainText(expected!);
      }
    });
  });
}
