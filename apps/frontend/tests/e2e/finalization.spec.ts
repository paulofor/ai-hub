import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

test.use({ browserName: 'chromium' });
const detailPath = process.env.FINALIZATION_E2E_DETAIL;
const details = detailPath ? JSON.parse(readFileSync(detailPath, 'utf8')) : ['COMPLETED', 'FAILED'].map((status, index) => ({
  id: 990100 + index, environment: 'sandbox.local', model: 'gpt-6-astra', profile: 'CHATGPT_CODEX_MKT',
  prompt: 'Teste de encerramento', status, createdAt: '2026-09-20T12:00:00Z',
  responseText: JSON.stringify({
    titulo: 'Resultado local de teste',
    comentario: `${status === 'FAILED' ? '**Falha no encerramento:** A branch remota divergiu; código local preservado.\n\n' : ''}Implementação integrada pelo PR de teste.`,
    impactoAumentoVendas: 'medio', alterouCodigoRepositorio: true, resumoCodigoPr: 'Corrige encerramento.', sugestaoMelhoriaAmbiente: ''
  })
}));

for (const deviceName of ['Desktop Chrome', 'iPhone 15 Pro', 'Pixel 7']) {
  test.describe(`Encerramento — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });

    for (const detail of details) {
      test(`preserva resultado e status ${detail.status} recebidos pelo backend`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
        await page.route(`**/api/codex/requests/${detail.id}`, route => route.fulfill({ json: detail }));
        await page.goto(`/codex/requests/${detail.id}`);
        const response = page.getByTestId('codex-response');
        await expect(response).toContainText('Implementação integrada pelo PR de teste.');
        if (detail.status === 'FAILED') {
          await expect(response).toContainText('Falha no encerramento');
          await expect(response).toContainText('A branch remota divergiu');
          await expect(page.getByText('Falhou', { exact: true })).toBeVisible();
        } else {
          await expect(response).not.toContainText('Falha no encerramento');
          await expect(page.getByText('Concluída', { exact: true })).toBeVisible();
        }
        await response.scrollIntoViewIfNeeded();
        const box = await response.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        await page.screenshot({ path: testInfo.outputPath('finalization.png'), fullPage: true });
        expect(errors).toEqual([]);
      });
    }
  });
}
