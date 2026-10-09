import { devices, expect, test, type Page } from '@playwright/test';

type Hint = {
  id: number; label: string; phrase: string; type: 'prompt' | 'text'; active: boolean;
  environmentId: number | null; environmentName: string | null; createdAt: string; updatedAt: string;
};
const ENVIRONMENT = 'test/prompt-hints@main';
const NOW = '2026-10-09T10:00:00Z';
const environments = [
  { id: 991001, name: ENVIRONMENT, active: true, createdAt: NOW },
  { id: 991002, name: 'test/other@main', active: true, createdAt: NOW },
  { id: 991003, name: 'sandbox', active: true, createdAt: NOW }
];

function fixture(): Hint[] {
  const hint = (id: number, label: string, type: Hint['type'], active: boolean, environmentId: number | null = null): Hint => ({
    id, label, phrase: `Frase sintética de ${label}.`, type, active, environmentId,
    environmentName: environments.find((env) => env.id === environmentId)?.name ?? null, createdAt: NOW, updatedAt: NOW
  });
  return [
    hint(990001, 'Orientação global', 'prompt', true),
    hint(990002, 'Texto global', 'text', true),
    hint(990003, 'Texto inativo', 'text', false),
    hint(990004, 'Orientação do ambiente', 'prompt', true, 991001),
    hint(990005, 'Orientação inativa', 'prompt', false, 991001),
    hint(990006, 'Outro ambiente', 'prompt', true, 991002),
    hint(990007, 'Orientação sandbox', 'prompt', true, 991003)
  ];
}

async function mockApi(page: Page, hints: Hint[], options: { failStatus?: boolean; failList?: boolean } = {}) {
  const submissions: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let json: unknown = [];
    if (path === '/api/account/read') json = { connected: true, status: 'connected', executable: true };
    if (path === '/api/environments/active' || path === '/api/environments') json = environments;
    if (path === '/api/codex/models/active') json = [{ id: 'gpt-6-sol', modelName: 'gpt-6-sol' }];
    if (path === '/api/prompt-hints') {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        const created: Hint = { ...payload, id: 990008, environmentId: payload.environmentId ?? null,
          environmentName: environments.find((env) => env.id === payload.environmentId)?.name ?? null,
          createdAt: NOW, updatedAt: NOW };
        hints.push(created);
        json = created;
      } else if (url.searchParams.has('environment')) {
        if (options.failList) return route.fulfill({ status: 503, json: { error: 'Falha sintética ao consultar itens' } });
        const environment = environments.find((env) => env.name === url.searchParams.get('environment'));
        json = hints.filter((hint) => hint.active && (!hint.environmentId || hint.environmentId === environment?.id));
      } else json = hints;
    }
    if (/^\/api\/prompt-hints\/\d+(\/status)?$/.test(path)) {
      const hint = hints.find((item) => item.id === Number(path.split('/')[3]))!;
      if (path.endsWith('/status')) {
        if (options.failStatus) return route.fulfill({ status: 500, json: { error: 'Falha sintética ao salvar status' } });
        hint.active = request.postDataJSON().active;
      } else if (request.method() === 'PUT') {
        Object.assign(hint, request.postDataJSON());
        hint.environmentId ??= null;
        hint.environmentName = environments.find((env) => env.id === hint.environmentId)?.name ?? null;
      }
      json = hint;
    }
    if (path === '/api/codex/requests') {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        submissions.push(payload);
        json = { ...payload, id: 990091, status: 'COMPLETED', responseText: 'Resposta sintética local.', createdAt: NOW };
      } else json = { content: [], totalPages: 0, totalElements: 0 };
    }
    if (path === '/api/codex/requests/metrics') json = { day: { requestCount: 0, interactionCount: 0, durationMs: 0 } };
    if (path === '/api/codex/requests/queue') json = { profile: url.searchParams.get('profile'), updatedAt: NOW, requests: [] };
    return route.fulfill({ json });
  });
  return { submissions, errors };
}

const screens = ['/codex', '/codex-chatgpt', '/codex-chatgpt-mkt', '/codex-chatgpt-sandbox'];

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile Pixel 7' : 'desktop Chromium', () => {
    if (mobile) {
      const device = devices['Pixel 7'];
      test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
        isMobile: device.isMobile, hasTouch: device.hasTouch });
    }

    test('inativa, edita, recarrega e reativa mantendo o cadastro', async ({ page }, testInfo) => {
      const hints = fixture();
      const { errors } = await mockApi(page, hints);
      await page.goto('/prompt-hints');
      await expect(page.getByLabel('Ativo nas solicitações')).toBeChecked();
      const row = page.getByRole('row').filter({ hasText: hints[0].label });
      await row.getByRole('button', { name: 'Inativar Orientação global', exact: true }).click();
      await expect(row.getByRole('cell', { name: 'Inativo', exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('Item inativado');
      expect(hints[0].phrase).toBe('Frase sintética de Orientação global.');
      await page.reload();
      await expect(row.getByRole('cell', { name: 'Inativo', exact: true })).toBeVisible();
      await row.getByRole('button', { name: 'Editar', exact: true }).click();
      await expect(page.getByLabel('Ativo nas solicitações')).not.toBeChecked();
      await page.getByLabel('Texto do item').fill('Texto editado do item inativo.');
      await page.getByRole('button', { name: 'Atualizar item', exact: true }).click();
      await expect(row).toContainText('Texto editado do item inativo.');
      await expect(row.getByRole('cell', { name: 'Inativo', exact: true })).toBeVisible();
      await page.getByLabel('Nome do item', { exact: true }).fill('Novo item inativo');
      await page.getByLabel('Texto do item').fill('Texto novo de homologação.');
      await page.getByLabel('Tipo de uso').selectOption('text');
      await page.getByLabel('Ambiente associado (opcional)').selectOption('991001');
      await page.getByLabel('Ativo nas solicitações').uncheck();
      await page.getByRole('button', { name: 'Cadastrar item', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: 'Novo item inativo' })).toContainText('Inativo');
      await row.getByRole('button', { name: 'Ativar Orientação global', exact: true }).click();
      await expect(row.getByRole('cell', { name: 'Ativo', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('prompt-hints-status.png'), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.goto('/codex-chatgpt-mkt');
      await expect(page.getByRole('checkbox', { name: /Orientação global/ })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Novo item inativo/ })).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    for (const screen of screens) {
      test(`${screen} atualiza opções e seleção ao voltar à aba e envia apenas os itens ativos`, async ({ page }, testInfo) => {
        const hints = fixture();
        const { submissions, errors } = await mockApi(page, hints);
        await page.goto(screen);
        const global = page.getByRole('checkbox', { name: /Orientação global/ });
        await expect(global).toBeVisible();
        await expect(page.getByRole('checkbox', { name: /Texto inativo|Orientação inativa|Outro ambiente/ })).toHaveCount(0);
        await expect(page.getByRole('checkbox', { name: screen.endsWith('sandbox') ? /Orientação sandbox/ : /Orientação do ambiente/ })).toBeVisible();
        await global.check();
        await page.getByRole('checkbox', { name: /Texto global/ }).check();
        const prompt = screen === '/codex' ? page.getByPlaceholder('Descreva o que o Codex deve fazer...') : page.locator('textarea[required]');
        await prompt.fill(screen === '/codex' ? 'Pedido sintético local.' : `${hints[1].phrase}\nTexto editado pelo usuário.`);
        const draft = await prompt.inputValue();
        hints[0].active = false;
        hints[1].active = false;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(global).toHaveCount(0);
        await expect(page.getByRole('checkbox', { name: /Texto global/ })).toHaveCount(0);
        await expect(prompt).toHaveValue(draft);
        hints[0].active = true;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(global).toBeVisible();
        await expect(global).not.toBeChecked();
        await global.check();
        const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/codex/requests' && res.request().method() === 'POST');
        await page.getByRole('button', { name: screen === '/codex' ? 'Enviar para o Codex' : 'Enviar mensagem', exact: true }).click();
        expect((await response).ok()).toBe(true);
        await expect.poll(() => submissions.length).toBe(1);
        expect(submissions[0].prompt).toContain(hints[0].phrase);
        expect(submissions[0].prompt).not.toContain(hints[2].phrase);
        expect(submissions[0].prompt).not.toContain(hints[4].phrase);
        if (screen === '/codex') expect(submissions[0].prompt).not.toContain(hints[1].phrase);
        else expect(submissions[0].screenPromptItems).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('request-active-items.png'), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
      });
    }
  });
}

test('falha de gravação preserva o status, mantém a tabela e permite nova tentativa', async ({ page }) => {
  const hints = fixture();
  const options = { failStatus: true };
  const { errors } = await mockApi(page, hints, options);
  await page.goto('/prompt-hints');
  const row = page.getByRole('row').filter({ hasText: hints[0].label });
  const toggle = row.getByRole('button', { name: 'Inativar Orientação global', exact: true });
  await toggle.click();
  await expect(page.getByRole('alert')).toHaveText('Falha sintética ao salvar status');
  await expect(row.getByRole('cell', { name: 'Ativo', exact: true })).toBeVisible();
  await expect(toggle).toBeEnabled();
  options.failStatus = false;
  await toggle.click();
  await expect(row.getByRole('cell', { name: 'Inativo', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('falha de atualização remove seleção antiga sem apagar o rascunho', async ({ page }) => {
  const hints = fixture();
  const options = { failList: false };
  const { errors } = await mockApi(page, hints, options);
  await page.goto('/codex-chatgpt-mkt');
  await page.getByRole('checkbox', { name: /Orientação global/ }).check();
  await page.locator('textarea[required]').fill('Rascunho preservado.');
  options.failList = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Falha sintética ao consultar itens', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Orientação global/ })).toHaveCount(0);
  await expect(page.locator('textarea[required]')).toHaveValue('Rascunho preservado.');
  options.failList = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('checkbox', { name: /Orientação global/ })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('todos os itens inativos deixam a composição sem opções', async ({ page }) => {
  const hints = fixture().map((hint) => ({ ...hint, active: false }));
  await mockApi(page, hints);
  await page.goto('/codex-chatgpt-mkt');
  await expect(page.getByText('Nenhum item configurado para este ambiente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('a interface também rejeita itens explicitamente inativos recebidos em uma resposta antiga', async ({ page }) => {
  const hints = fixture();
  await mockApi(page, hints);
  await page.route('**/api/prompt-hints?**', (route) => route.fulfill({ json: hints.filter((hint) => !hint.environmentId) }));
  await page.goto('/codex-chatgpt-mkt');
  await expect(page.getByRole('checkbox', { name: /Orientação global/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Texto inativo/ })).toHaveCount(0);
});

test('resposta atrasada de uma consulta não recoloca item inativado na aba', async ({ page }) => {
  const hints = fixture();
  await mockApi(page, hints);
  await page.goto('/codex-chatgpt-mkt');
  const checkbox = page.getByRole('checkbox', { name: /Orientação global/ });
  await expect(checkbox).toBeVisible();
  let releaseOldResponse: () => void = () => undefined;
  let oldResponseHeld = false;
  const oldResponse = new Promise<void>((resolve) => { releaseOldResponse = resolve; });
  let count = 0;
  await page.route('**/api/prompt-hints?**', async (route) => {
    count++;
    if (count === 1) {
      const stale = hints.filter((hint) => !hint.environmentId);
      oldResponseHeld = true;
      await oldResponse;
      await route.fulfill({ json: stale });
    } else await route.fulfill({ json: [] });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => oldResponseHeld).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(checkbox).toHaveCount(0);
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/prompt-hints');
  releaseOldResponse();
  await response;
  await expect(page.getByText('Nenhum item configurado para este ambiente.', { exact: true })).toBeVisible();
  await expect(checkbox).toHaveCount(0);
});
