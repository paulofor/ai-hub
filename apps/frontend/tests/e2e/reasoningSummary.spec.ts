import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

const generatedDetailPath = process.env.REASONING_SUMMARY_E2E_DETAIL;
test.use({ browserName: 'chromium' });
const detail = generatedDetailPath ? JSON.parse(readFileSync(generatedDetailPath, 'utf8')) : {
  id: 990001, environment: 'sandbox.local', model: 'gpt-6-astra', profile: 'CHATGPT_CODEX',
  status: 'COMPLETED', prompt: 'Validação local', createdAt: '2026-09-13T12:00:00Z',
  responseText: 'Resumo Codex App Server', reasoningSummary: 'Resumo público validado por JSON-RPC.'
};

for (const deviceName of ['Desktop Chrome', 'iPhone 15 Pro']) {
  test.describe(`Resumo do raciocínio — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({
      viewport: device.viewport, userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch
    });

    test('exibe e copia o mesmo resumo recebido pelo callback e persistido no backend', async ({ page, context }, testInfo) => {
      const errors: string[] = [];
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8082' });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/codex/requests/*/previous', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route(`**/api/codex/requests/${detail.id}`, (route) => route.fulfill({ json: detail }));
      await page.goto(`/codex/requests/${detail.id}`);
      const summary = page.getByTestId('codex-reasoning-summary');
      await expect(summary).toHaveText(detail.reasoningSummary);
      await page.getByRole('button', { name: 'Copiar resumo' }).click();
      await expect(page.getByText('Resumo do raciocínio copiado para a área de transferência.')).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(detail.reasoningSummary);
      await expect(page.getByTestId('codex-response')).toContainText(detail.responseText);
      await summary.scrollIntoViewIfNeeded();
      const box = await summary.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: testInfo.outputPath('reasoning-summary.png'), fullPage: true });
      expect(errors).toEqual([]);
    });

    test('atualiza resumo durante polling, aceita legado e mantém ausência explícita', async ({ page }) => {
      await page.clock.install();
      let completed = false;
      await page.route('**/api/codex/requests/*/previous', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/codex/requests/990002', (route) => route.fulfill({ json: {
        ...detail, id: 990002, status: completed ? 'COMPLETED' : 'RUNNING',
        reasoningSummary: undefined, reasoning_summary: completed ? 'Primeira seção.\n\nSegunda seção.' : '  '
      } }));
      await page.goto('/codex/requests/990002');
      await expect(page.getByTestId('codex-reasoning-summary')).toHaveText('—');
      await expect(page.getByText('Não disponibilizado pelo modelo')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copiar resumo' })).toHaveCount(0);
      completed = true;
      await page.clock.fastForward(16_000);
      await expect(page.getByTestId('codex-reasoning-summary')).toContainText('Primeira seção.');
      await expect(page.getByTestId('codex-reasoning-summary')).toContainText('Segunda seção.');
      await expect(page.getByRole('button', { name: 'Copiar resumo' })).toBeVisible();
      await expect(page.getByTestId('codex-response')).toContainText(detail.responseText);
    });
  });
}
