import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

const at = '2026-10-08T00:00:00Z';
const reviewText = 'Conferindo se a entrega atende ao pedido original e se há trabalho autorizado pendente antes de encerrar.';
const fixturePath = process.env.MARKETING_REVIEW_E2E_DETAIL;
const detail = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : {
  id: 9903276, environment: 'paulofor/marketing-hub', profile: 'CHATGPT_CODEX_MKT', model: 'fixture-model',
  status: 'COMPLETED', createdAt: at, prompt: 'Produto sintético: salvei a janela e fiquei parado.',
  responseText: JSON.stringify({ titulo: 'Passagem conferida', comentario: 'Resultado sintético conferido.' }),
  executionTrace: { version: 1, revision: 1, plans: [], droppedEvents: 0, droppedPlans: 0, events: [
    { id: 'fixture-review', itemId: 'marketing-completion-review', sequence: 1, turnId: 'first-turn', kind: 'message',
      label: 'Atualização pública', status: 'completed', receivedAt: at, result: reviewText, details: { output: reviewText }, evidence: [] },
  ] },
};

for (const deviceName of ['Desktop Chrome', 'Pixel 7']) {
  test.describe(`Conferência MKT — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });

    test('trace informa a conferência e polling entrega a resposta final na mesma solicitação', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      let finished = false;
      await page.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        // Vite source modules can also contain /api/ in their path.
        if (!pathname.startsWith('/api/')) return route.continue();
        if (pathname === `/api/codex/requests/${detail.id}`) {
          return route.fulfill({ json: { ...detail, status: finished ? 'COMPLETED' : 'RUNNING',
            responseText: finished ? detail.responseText : null } });
        }
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto(`/codex/requests/${detail.id}`);
      await expect(page.getByTestId('execution-timeline')).toContainText(reviewText);
      await expect(page.getByTestId('codex-response')).not.toContainText('Passagem conferida');
      finished = true;
      await page.clock.fastForward(16000);
      await expect(page.getByTestId('codex-response')).toContainText('Passagem conferida');
      await expect(page.getByTestId('execution-timeline')).toContainText(reviewText);
      expect(page.url()).toContain(`/codex/requests/${detail.id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('marketing-review.png'), fullPage: true });
    });
  });
}
