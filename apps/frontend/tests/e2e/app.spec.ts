import { expect, test } from '@playwright/test';

test('renders the dashboard shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'AI Hub 6' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Codex ChatGPT MKT' })).toBeVisible();
});

test('warns on the request PR button when a batch has accumulated code', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'produção' }] });
  });
  await page.route('**/api/account/models', async (route) => {
    await route.fulfill({ json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }] });
  });
  await page.route('**/api/codex/requests/metrics?**', async (route) => {
    await route.fulfill({ json: { day: { startsAt: '2026-07-24T00:00:00Z', requestCount: 1, interactionCount: 1, durationMs: 1000 } } });
  });
  await page.route('**/api/codex/conversations?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/prompt-hints?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/codex/requests?**', async (route) => {
    await route.fulfill({
      json: {
        content: [
          {
            id: 527,
            environment: 'produção',
            model: 'gpt-5',
            version: 'aihub-6',
            profile: 'CHATGPT_CODEX',
            prompt: 'Ajustar aviso no botão de PR',
            status: 'COMPLETED',
            createdAt: '2026-07-24T12:00:00Z',
            workBatchKey: 'aihub/codex-chatgpt-527'
          }
        ]
      }
    });
  });

  await page.goto('/codex-chatgpt');

  await expect(page.getByText('Código acumulado para merge: 1 solicitação(ões) concluída(s) neste lote ainda precisam passar por PR antes do merge.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pedir PR Código pendente/ })).toBeEnabled();
});
