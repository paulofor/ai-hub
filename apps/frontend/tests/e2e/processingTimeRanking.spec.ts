import { devices, expect, test } from '@playwright/test';

const ranking = [
  { id: 990101, durationMs: 7_200_000, totalTokens: 12_345, status: 'COMPLETED' },
  { id: 990102, durationMs: 3_600_000, totalTokens: 9_876_543, status: 'FAILED' },
  { id: 990103, durationMs: 90_000, totalTokens: 0, status: 'CANCELLED' },
  { id: 990104, durationMs: 30_000, totalTokens: null, status: 'COMPLETED' },
  { id: 990105, durationMs: 10_000, status: 'COMPLETED' }
].map((item) => ({
  environment: 'test/processing-time-ranking@main',
  model: 'gpt-6.1-sol',
  reasoningEffort: 'HIGH',
  profile: 'CHATGPT_CODEX_MKT',
  createdAt: '2026-10-04T10:00:00Z',
  requestTitle: `Solicitação sintética ${item.id}`,
  ...item
}));

const mobileDevice = devices['Pixel 7'];

for (const device of ['desktop', 'mobile'] as const) {
  test.describe(`processing time ranking ${device}`, () => {
    test.use(device === 'mobile' ? {
      viewport: mobileDevice.viewport,
      userAgent: mobileDevice.userAgent,
      deviceScaleFactor: mobileDevice.deviceScaleFactor,
      isMobile: mobileDevice.isMobile,
      hasTouch: mobileDevice.hasTouch
    } : { viewport: { width: 1366, height: 768 } });

    test('shows each stored token total without changing the duration ranking', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let rankingCalls = 0;
      await page.route('**/api/codex/requests/processing-time-ranking', (route) => {
        rankingCalls++;
        return route.fulfill({ json: ranking });
      });

      await page.goto('/codex/processing-time-ranking');
      await expect(page.getByRole('columnheader', { name: 'Total de tokens', exact: true })).toBeVisible();
      const rows = page.getByRole('row');
      await expect(rows).toHaveCount(6);
      for (const [index, expected] of ['12.345', '9.876.543', '0', 'Não informado', 'Não informado'].entries()) {
        const row = rows.nth(index + 1);
        await expect(row.getByRole('link')).toHaveAttribute('href', `/codex/requests/${ranking[index].id}`);
        await expect(row.getByRole('cell').nth(4)).toHaveText(expected);
      }
      await expect(rows.nth(1)).toContainText('2h 0min');
      await expect(rows.nth(2)).toContainText('Falhou');
      await expect(rows.nth(3)).toContainText('Cancelada');
      await expect(rows.nth(1).getByRole('cell').nth(5)).toHaveText('2h 0min');
      expect(rankingCalls).toBe(1);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      const table = page.getByRole('table');
      if (device === 'mobile') {
        await table.evaluate((element) => { element.parentElement!.scrollLeft = element.parentElement!.scrollWidth; });
      }
      await expect(rows.nth(1).getByRole('cell').nth(4)).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`ranking-tokens-${device}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Escuro', exact: true }).click();
      await expect(rows.nth(1).getByRole('cell').nth(4)).toHaveText('12.345');
      expect(errors).toEqual([]);
    });

    test('keeps the empty state without inventing token totals', async ({ page }) => {
      await page.route('**/api/codex/requests/processing-time-ranking', (route) => route.fulfill({ json: [] }));
      await page.goto('/codex/processing-time-ranking');
      await expect(page.getByText('Ainda não existem solicitações com tempo de processamento contabilizado.')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });

    test('shows the API failure instead of a zero total', async ({ page }) => {
      await page.route('**/api/codex/requests/processing-time-ranking', (route) => route.fulfill({ status: 503, json: { message: 'Falha sintética' } }));
      await page.goto('/codex/processing-time-ranking');
      await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o ranking');
      await expect(page.getByRole('table')).toHaveCount(0);
    });
  });
}
