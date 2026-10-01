import { devices, expect, test, type Page } from '@playwright/test';

type Environment = { id: number; name: string; active: boolean; createdAt: string };
const fixture = (): Environment[] => [
  { id: 1, name: 'test/stag-master@main', active: true, createdAt: '2026-10-01T00:00:00Z' },
  { id: 2, name: 'test/sisacao-9@main', active: false, createdAt: '2026-10-01T00:00:00Z' }
];

async function mockApi(page: Page, environments: Environment[], options: { failStatus?: boolean } = {}) {
  const submissions: Record<string, unknown>[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown = [];
    if (path === '/api/account/read') json = { connected: true, status: 'connected', executable: true };
    if (path === '/api/environments/active') json = environments.filter((item) => item.active);
    if (path === '/api/environments') {
      if (request.method() === 'POST') {
        const created = { ...request.postDataJSON(), id: 3, createdAt: '2026-10-01T00:00:00Z' };
        environments.push(created);
        json = created;
      } else json = environments;
    }
    if (path.match(/^\/api\/environments\/\d+\/status$/)) {
      if (options.failStatus) return route.fulfill({ status: 500, json: { error: 'Falha sintética ao salvar status' } });
      const item = environments.find((env) => env.id === Number(path.split('/')[3]))!;
      item.active = request.postDataJSON().active;
      json = item;
    }
    if (path === '/api/codex/models/active') json = [{ id: 1, modelName: 'gpt-6-sol', active: true }];
    if (path === '/api/codex/requests') {
      if (request.method() === 'POST') {
        submissions.push(request.postDataJSON());
        json = { ...request.postDataJSON(), id: 990061, status: 'PENDING', createdAt: '2026-10-01T00:00:00Z' };
      } else json = { content: [], totalPages: 0, totalElements: 0 };
    }
    if (path === '/api/codex/requests/metrics') json = { day: { requestCount: 0, interactionCount: 0, durationMs: 0 } };
    if (path === '/api/codex/requests/queue') json = { profile: new URL(request.url()).searchParams.get('profile'), updatedAt: '2026-10-01T00:00:00Z', requests: [] };
    return route.fulfill({ json });
  });
  return submissions;
}

const screens = [
  { url: '/codex', send: 'Enviar para o Codex', prompt: 'Descreva o que o Codex deve fazer...' },
  { url: '/codex-chatgpt', send: 'Enviar mensagem', prompt: 'Digite sua solicitação para iniciar o diálogo com o Codex...' },
  { url: '/codex-chatgpt-mkt', send: 'Enviar mensagem', prompt: '' }
];

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile Pixel 7' : 'desktop Chromium', () => {
    if (mobile) {
      const device = devices['Pixel 7'];
      test.use({ viewport: device.viewport, userAgent: device.userAgent,
        deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });
    }

    test('administra status, cria inativo e reativa para envio', async ({ page }, testInfo) => {
      const environments = fixture();
      await mockApi(page, environments);
      await page.goto('/environments');
      await expect(page.getByLabel('Ambiente ativo')).toBeChecked();
      const activeRow = page.getByRole('row').filter({ hasText: environments[0].name });
      await activeRow.getByRole('button', { name: `Desativar ${environments[0].name}`, exact: true }).click();
      await expect(activeRow.getByRole('cell', { name: 'Inativo', exact: true })).toBeVisible();
      await activeRow.getByRole('button', { name: `Ativar ${environments[0].name}`, exact: true }).click();
      await expect(activeRow.getByRole('cell', { name: 'Ativo', exact: true })).toBeVisible();
      await page.getByLabel('Nome do ambiente', { exact: true }).fill('test/inactive-created@main');
      await page.getByLabel('Ambiente ativo').uncheck();
      await page.getByRole('button', { name: 'Cadastrar ambiente' }).click();
      await expect(page.getByRole('row').filter({ hasText: 'test/inactive-created@main' })).toContainText('Inativo');
      await page.screenshot({ path: testInfo.outputPath('environments-status.png'), fullPage: true });
      if (mobile) await page.getByRole('button', { name: 'Abrir menu' }).click();
      await page.getByRole('link', { name: 'Codex ChatGPT', exact: true }).click();
      await expect(page.getByLabel('Ambiente', { exact: true }).locator('option')).toHaveText(['Selecione um ambiente', environments[0].name]);
    });

    for (const screen of screens) {
      test(`${screen.url} exclui inativos, envia ativo e limpa seleção obsoleta`, async ({ page }) => {
        const environments = fixture();
        const submissions = await mockApi(page, environments);
        await page.goto(screen.url);
        const selector = page.getByLabel('Ambiente', { exact: true });
        await expect(selector).toHaveValue(environments[0].name);
        await expect(selector.locator('option')).toHaveText(['Selecione um ambiente', environments[0].name]);
        const prompt = screen.url === '/codex' ? page.getByPlaceholder(screen.prompt) : page.locator('textarea[required]');
        await prompt.fill('Solicitação sintética sem serviço externo');
        await page.getByRole('button', { name: screen.send, exact: true }).click();
        await expect.poll(() => submissions.length).toBe(1);
        expect(submissions[0].environment).toBe(environments[0].name);
        // Simulates deactivation in another tab. Do not silently redirect the draft.
        environments[0].active = false;
        environments[1].active = true;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(selector).toHaveValue('');
        await expect(selector.locator('option')).toHaveText(['Selecione um ambiente', environments[1].name]);
        await expect(page.getByRole('button', { name: screen.send, exact: true })).toBeDisabled();
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(selector).toHaveValue('');
        await selector.selectOption(environments[1].name);
        await expect(selector).toHaveValue(environments[1].name);
      });
    }
  });
}

for (const screen of screens) {
  test(`${screen.url} bloqueia envio quando não há ativos`, async ({ page }) => {
    const environments = fixture().map((item) => ({ ...item, active: false }));
    const submissions = await mockApi(page, environments);
    await page.goto(screen.url);
    await expect(page.getByLabel('Ambiente', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Ambiente', { exact: true }).locator('option')).toHaveText(['Nenhum ambiente ativo disponível']);
    await expect(page.getByRole('button', { name: screen.send, exact: true })).toBeDisabled();
    expect(submissions).toHaveLength(0);
  });
}

test('falha de atualização preserva estado e permite nova tentativa', async ({ page }) => {
  const options = { failStatus: true };
  const environments = fixture();
  await mockApi(page, environments, options);
  await page.goto('/environments');
  const toggle = page.getByRole('button', { name: `Desativar ${environments[0].name}`, exact: true });
  await toggle.click();
  await expect(page.getByRole('alert')).toHaveText('Falha sintética ao salvar status');
  await expect(toggle).toBeEnabled();
  options.failStatus = false;
  await toggle.click();
  await expect(page.getByRole('button', { name: `Ativar ${environments[0].name}`, exact: true })).toBeEnabled();
});

test('conversa salva de ambiente inativo não recoloca esse ambiente no seletor', async ({ page }) => {
  const environments = fixture();
  await mockApi(page, environments);
  const conversation = { id: 990061, title: 'Fixture salva inativa', environment: environments[1].name,
    model: 'gpt-6-sol', messageCount: 1, updatedAt: '2026-10-01T00:00:00Z',
    messages: [{ role: 'user', content: 'Contexto antigo sintético' }] };
  await page.route('**/api/codex/conversations?**', (route) => route.fulfill({ json: [conversation] }));
  await page.route('**/api/codex/conversations/990061', (route) => route.fulfill({ json: conversation }));
  await page.goto('/codex-chatgpt');
  await page.getByLabel('Conversa salva para contexto').selectOption('990061');
  await expect(page.getByLabel('Ambiente', { exact: true })).toHaveValue(environments[0].name);
  await expect(page.getByLabel('Ambiente', { exact: true }).locator('option')).toHaveText(['Selecione um ambiente', environments[0].name]);
});
