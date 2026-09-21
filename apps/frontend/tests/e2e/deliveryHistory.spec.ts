import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

const detailPath = process.env.DELIVERY_HISTORY_E2E_DETAIL;
const details = detailPath ? JSON.parse(readFileSync(detailPath, 'utf8')) : [10, 11, 12].map(number => ({
  id: 990200 + number, environment: 'test/delivery@main', model: 'gpt-6-astra', profile: 'CHATGPT_CODEX_MKT',
  prompt: `Entrega sintética ${number}`, status: 'COMPLETED', createdAt: '2026-09-21T00:00:00Z',
  responseText: `Entrega sintética confirmada ${number}`, pullRequestUrl: `https://github.com/test/delivery/pull/${number}`
}));

for (const deviceName of ['Desktop Chrome', 'iPhone 15 Pro']) {
  test.describe(`Histórico de entregas — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });

    test('mantém o PR de cada solicitação após pedidos repetidos', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
      for (const detail of details) {
        await page.route(`**/api/codex/requests/${detail.id}`, route => route.fulfill({ json: detail }));
        await page.goto(`/codex/requests/${detail.id}`);
        await expect(page.getByText('Concluída', { exact: true })).toBeVisible();
        await expect(page.getByTestId('codex-response')).toContainText(detail.responseText);
        await expect(page.locator(`a[href="${detail.pullRequestUrl}"]`)).toBeVisible();
        await expect(page.getByRole('button', { name: /Criar.*PR.*GitHub/ })).toHaveCount(0);
        await expect(page.getByText(/Pedidos de implementação incluem PR/)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
        for (const other of details.filter((item: { id: number }) => item.id !== detail.id)) {
          await expect(page.locator(`a[href="${other.pullRequestUrl}"]`)).toHaveCount(0);
        }
      }
      await page.screenshot({ path: testInfo.outputPath('delivery-history.png'), fullPage: true });
      expect(errors).toEqual([]);
    });
  });
}
