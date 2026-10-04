import { devices, expect, test, type Page } from '@playwright/test';

type Profile = 'CHATGPT_CODEX' | 'CHATGPT_CODEX_MKT' | 'CHATGPT_CODEX_SANDBOX';
const environment = 'test/layout@main';
const timestamp = '2026-10-01T12:00:00Z';
const response = JSON.stringify({ titulo: 'Entrega sintética', comentario: '**Resultado local** validado.',
  alterouCodigoRepositorio: true, resumoCodigoPr: 'Ajuste sintético.',
  orientacaoProximaAcao: 'Forneça o acesso de teste.', sugestaoMelhoriaAmbiente: 'Fixture sintética.' });
const item = (profile: Profile, id = 990101, status = 'COMPLETED', responseText = response) => ({
  id, environment, profile, model: 'gpt-6.1-sol', reasoningEffort: 'high', status,
  userMessage: `Pedido sintético ${id}`, prompt: `Pedido sintético ${id}`, responseText,
  createdAt: timestamp, startedAt: status === 'PENDING' ? undefined : timestamp,
  finishedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? timestamp : undefined, durationMs: 1_000,
  workBatchKey: `test-layout-${profile}`, workBranch: 'test/layout', totalTokens: 100
});

async function mockApi(page: Page, profile: Profile, initial = [item(profile)]) {
  const requests = [...initial];
  const calls: string[] = [];
  const requestQueries: URL[] = [];
  const submissions: Record<string, unknown>[] = [];
  let failSubmission = false;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    calls.push(path);
    if (path === '/api/codex/requests' && request.method() === 'GET') requestQueries.push(url);
    let json: unknown = [];
    if (path === '/api/account/read') json = { connected: true, status: 'connected', executable: true };
    if (path === '/api/environments/active') json = [{ id: 1, name: environment }];
    if (path === '/api/codex/models/active') json = [{ id: 1, modelName: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' }];
    if (path === '/api/products') json = [{ name: 'Produto sintético', modelName: 'gpt-6.1-sol', reasoningEffort: 'high' }];
    if (path === '/api/processes') json = [{ id: 91, number: '01', text: 'Processo sintético' }];
    if (path === '/api/codex/requests') {
      if (request.method() === 'POST') {
        if (failSubmission) return route.fulfill({ status: 500, json: { error: 'Falha sintética de envio' } });
        const payload = request.postDataJSON();
        submissions.push(payload);
        const created = { ...item(profile, 990102, 'PENDING', ''), ...payload };
        requests.unshift(created);
        json = created;
      } else json = { content: requests.map(row => ({ ...row, userMessage: undefined, responseText: undefined })),
        totalPages: 1, totalElements: requests.length };
    }
    if (path === '/api/codex/requests/recent-dialogue') json = [...requests].sort((a, b) => b.id - a.id).slice(0, 10)
      .map(({ id, environment, model, reasoningEffort, profile, status, userMessage, responseText, createdAt, finishedAt }) =>
        ({ id, environment, model, reasoningEffort, profile, status, userMessage, responseText, createdAt, finishedAt }));
    if (path === '/api/codex/requests/open-batch') json = requests;
    if (/^\/api\/codex\/requests\/\d+$/.test(path)) json = requests.find(row => row.id === Number(path.split('/').at(-1)));
    if (path === '/api/codex/requests/metrics') json = {
      day: { startsAt: timestamp, requestCount: 1, interactionCount: 2, durationMs: 1_000 },
      salesImpactDay: { muitoBaixo: 0, baixo: 0, medio: 1, alto: 0, muitoAlto: 0, total: 1 }, recentSalesImpact: []
    };
    return route.fulfill({ json });
  });
  return { calls, requestQueries, submissions, requests, fail: () => { failSubmission = true; } };
}

for (const deviceName of ['Desktop Chrome', 'Pixel 7']) {
  test.describe(deviceName, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile, hasTouch: device.hasTouch, timezoneId: 'America/Sao_Paulo' });

    for (const [profile, path] of [
      ['CHATGPT_CODEX', '/codex-chatgpt'], ['CHATGPT_CODEX_MKT', '/codex-chatgpt-mkt'],
      ['CHATGPT_CODEX_SANDBOX', '/codex-chatgpt-sandbox']
    ] as const) {
      test(`${profile} mostra término real, ausência histórica e conclusão por polling`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const finishedAt = '2026-10-02T01:45:00Z';
        const rows = ['COMPLETED', 'FAILED', 'CANCELLED', 'PENDING', 'RUNNING', 'COMPLETED']
          .map((status, index) => item(profile, 990301 + index, status, ''));
        rows.slice(0, 3).forEach(row => { row.finishedAt = finishedAt; });
        rows[5].finishedAt = undefined;
        const api = await mockApi(page, profile, rows);
        await page.clock.install({ time: new Date(timestamp) });
        await page.goto(path);
        const card = (id: number) => page.locator('li').filter({ has: page.getByRole('link', { name: 'Abrir detalhes', exact: true })
          .and(page.locator(`a[href="/codex/requests/${id}"]`)) });
        for (const id of [990301, 990302, 990303]) {
          await expect(card(id)).toContainText('Término da execução: 01/10/2026, 22:45');
          await expect(card(id).locator('time')).toHaveAttribute('datetime', finishedAt);
        }
        for (const id of [990304, 990305]) {
          await expect(card(id)).toContainText('Término da execução: Aguardando término');
          await expect(card(id).locator('time')).toHaveCount(0);
        }
        await expect(card(990306)).toContainText('Término da execução: Não informado');
        await expect(card(990306).locator('time')).toHaveCount(0);
        await card(990301).screenshot({ path: testInfo.outputPath('execution-finished-at.png') });
        const running = api.requests.find(row => row.id === 990305)!;
        running.status = 'COMPLETED';
        running.finishedAt = finishedAt;
        await page.clock.runFor(5_001);
        await expect(card(990305)).toContainText('Término da execução: 01/10/2026, 22:45');
        await expect(card(990305).locator('time')).toHaveAttribute('datetime', finishedAt);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
        expect(errors).toEqual([]);
      });
    }

    for (const profile of ['CHATGPT_CODEX', 'CHATGPT_CODEX_MKT'] as const) {
      test(`${profile} preserva controles, contexto e envio`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const api = await mockApi(page, profile);
        await page.goto(profile === 'CHATGPT_CODEX' ? '/codex-chatgpt' : '/codex-chatgpt-mkt');
        // A consulta deve recortar no servidor antes da paginação; caso contrário,
        // solicitações de outros perfis podem ocupar as vinte posições da Mira.
        await expect.poll(() => api.requestQueries.at(0)?.searchParams.get('profile')).toBe(profile);
        await expect(page.getByRole('heading', { name: 'Estado da conta (tempo real)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Lote atual' })).toBeVisible();
        await expect(page.getByLabel('Conversa salva para contexto')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Salvar conversa', exact: true })).toBeEnabled();
        await expect(page.getByRole('heading', { name: 'Título', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Comentário', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Orientação', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Copiar comentário', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Copiar mensagem do modelo para Google Docs' })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Pedir PR/ })).toBeEnabled();
        if (profile === 'CHATGPT_CODEX') {
          await expect(page.getByLabel('Produto', { exact: true })).toHaveCount(0);
          await expect(page.getByLabel('Processo', { exact: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'Fechar quadro de indicadores' })).toHaveCount(0);
          expect(api.calls).not.toContain('/api/processes');
          expect(api.calls).not.toContain('/api/products');
        } else {
          await expect(page.getByLabel('Produto', { exact: true })).toBeVisible();
          await expect(page.getByLabel('Processo', { exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Fechar quadro de indicadores' })).toBeVisible();
          await page.getByLabel('Produto', { exact: true }).selectOption('Produto sintético');
          await page.getByLabel('Processo', { exact: true }).selectOption('91');
        }
        await page.screenshot({ path: testInfo.outputPath('layout.png'), fullPage: true, animations: 'disabled' });
        const unread = page.getByRole('button', { name: 'Ir para primeira resposta não lida' });
        await unread.click();
        await expect(page.locator('article').filter({ hasText: 'Entrega sintética' })).toBeFocused();
        await page.getByRole('checkbox', { name: 'Lido', exact: true }).check();
        await expect(unread).toBeDisabled();
        await page.reload();
        await expect(page.getByRole('checkbox', { name: 'Lido', exact: true })).toBeChecked();
        await page.getByRole('button', { name: 'Retirar solicitação da tela', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Comentário', exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Abrir detalhes', exact: true })).toHaveCount(1);
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Comentário', exact: true })).toHaveCount(0);
        if (profile === 'CHATGPT_CODEX_MKT') {
          await page.getByLabel('Produto', { exact: true }).selectOption('Produto sintético');
          await page.getByLabel('Processo', { exact: true }).selectOption('91');
        }
        await page.locator('textarea[required]').fill('Novo pedido sintético');
        await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
        await expect.poll(() => api.submissions.length).toBe(1);
        const payload = api.submissions[0];
        expect(payload.profile).toBe(profile);
        expect(payload.environment).toBe(environment);
        expect(payload.model).toBe('gpt-6.1-sol');
        if (profile === 'CHATGPT_CODEX') {
          expect(payload).not.toHaveProperty('processId');
          expect(payload).not.toHaveProperty('productName');
          expect(payload.prompt).toContain('Na resposta final do Codex ChatGPT técnico');
          expect(payload.prompt).not.toContain('Nosso objetivo principal é gerar vendas');
        } else {
          expect(payload.processId).toBe(91);
          expect(payload.productName).toBe('Produto sintético');
          expect(payload.prompt).toContain('modo MKT');
          expect(payload.prompt).not.toContain('Na resposta final do Codex ChatGPT técnico');
        }
        expect(errors).toEqual([]);
      });
    }

    test('resposta técnica legada recebe cartão e leitura; falha pode ser retirada', async ({ page }) => {
      await mockApi(page, 'CHATGPT_CODEX', [item('CHATGPT_CODEX', 990101, 'COMPLETED', '**Resposta antiga** preservada.'),
        item('CHATGPT_CODEX', 990103, 'FAILED', 'Falha sintética do worker')]);
      await page.goto('/codex-chatgpt');
      await expect(page.getByRole('heading', { name: 'Comentário', exact: true })).toBeVisible();
      await expect(page.getByText('Resposta antiga', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Retirar da tela', exact: true }).click();
      await expect(page.locator('article').filter({ hasText: 'Falha sintética do worker' })).toHaveCount(0);
      await page.getByRole('checkbox', { name: 'Lido', exact: true }).check();
      await expect(page.getByRole('button', { name: 'Retirar solicitação da tela', exact: true })).toBeVisible();
    });

    test('falha de envio técnico aparece e preserva o rascunho', async ({ page }) => {
      const api = await mockApi(page, 'CHATGPT_CODEX', []);
      api.fail();
      await page.goto('/codex-chatgpt');
      await page.locator('textarea[required]').fill('Rascunho sintético');
      await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Falha sintética de envio');
      await expect(page.locator('textarea[required]')).toHaveValue('Rascunho sintético');
      expect(api.submissions).toHaveLength(0);
    });
  });
}

test('perfil técnico preserva o limite visual de vinte solicitações ativas', async ({ page }) => {
  await mockApi(page, 'CHATGPT_CODEX', Array.from({ length: 20 }, (_, index) => item('CHATGPT_CODEX', 990200 + index, 'PENDING', '')));
  await page.goto('/codex-chatgpt');
  await expect(page.locator('textarea[required]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar mensagem', exact: true })).toBeDisabled();
  await expect(page.getByText('Aguarde: as 20 posições estão ocupadas por solicitações pendentes ou em processamento.')).toBeVisible();
});

test('dashboard usa totais consolidados nos cartões e gráficos operacionais', async ({ page }) => {
  const profiles: (string | null)[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/codex/requests/metrics') return route.fulfill({ json: [] });
    const profile = url.searchParams.get('profile');
    profiles.push(profile);
    const window = { startsAt: timestamp, requestCount: profile ? 1 : 2, interactionCount: profile ? 2 : 5,
      durationMs: profile ? 1_000 : 3_000, totalTokens: profile ? 100 : 350, weeklyQuotaConsumedPercentagePoints: profile ? 1 : 3 };
    return route.fulfill({ json: { day: window, week: window, month: window,
      series: { daily: [window], weekly: [window], monthly: [window] }, recentSalesImpact: [] } });
  });
  await page.goto('/');
  await expect(page.getByLabel('01/10/26: 350')).toHaveCount(2);
  await expect(page.getByLabel('01/10/26: 3 p.p.')).toHaveCount(2);
  expect(profiles).toContain(null);
  expect(profiles).toContain('CHATGPT_CODEX_MKT');
  expect(profiles).not.toContain('CHATGPT_CODEX');
});
