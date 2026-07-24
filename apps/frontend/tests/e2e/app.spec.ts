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

test('formats markdown file references with a readable filename chip', async ({ page }) => {
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
    await route.fulfill({ json: { day: { startsAt: '2026-07-24T00:00:00Z', requestCount: 0, interactionCount: 0, durationMs: 0 } } });
  });
  await page.route('**/api/codex/conversations?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/prompt-hints?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/codex/requests?**', async (route) => {
    await route.fulfill({ json: { content: [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX', JSON.stringify([
      {
        id: 'assistant-file-ref',
        role: 'assistant',
        content: '- [apps/sandbox-orchestrator/src/jobProcessor.ts](/root/ai-hub/src/ai-hub-55705dc7-f44c-4ac0-a36d-c12fff9cc320-65mKnm/repo/apps/sandbox-orchestrator/src/jobProcessor.ts): PR automático agora usa apenas bullets.\n- [docs/diario/registros1.md](/root/ai-hub/src/ai-hub-55705dc7-f44c-4ac0-a36d-c12fff9cc320-65mKnm/repo/docs/diario/registros1.md:2549): registro obrigatório atualizado.',
        createdAt: '2026-07-24T12:00:00Z'
      }
    ]));
  });

  await page.goto('/codex-chatgpt');

  const firstFileReference = page.locator('[title$="/apps/sandbox-orchestrator/src/jobProcessor.ts"]').first();
  await expect(firstFileReference).toBeVisible();
  await expect(firstFileReference.getByText('TS', { exact: true })).toBeVisible();
  await expect(firstFileReference.getByText('jobProcessor.ts')).toBeVisible();
  await expect(firstFileReference.getByText('apps/sandbox-orchestrator/src')).toBeVisible();
  await expect(page.getByText('/root/ai-hub/src/ai-hub-55705dc7-f44c-4ac0-a36d-c12fff9cc320-65mKnm/repo/apps/sandbox-orchestrator/src/jobProcessor.ts')).toHaveCount(0);
  await expect(page.getByText('PR automático agora usa apenas bullets.')).toBeVisible();
});
