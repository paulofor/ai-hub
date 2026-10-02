import { devices, expect, test, type Page } from '@playwright/test';
import type { CodexProfile, CodexStatus } from '../../src/lib/codex';

const profile: CodexProfile = 'CHATGPT_CODEX_MKT';
const environment = 'test/dialogue@main';
const timestamp = '2026-10-01T00:00:00Z';
const response = (id: number) => JSON.stringify({ titulo: `Resposta ${id}`, comentario: `Conteúdo público ${id}`,
  impactoAumentoVendas: 'medio', alterouCodigoRepositorio: false, resumoCodigoPr: '', sugestaoMelhoriaAmbiente: '' });
const row = (number: number, requestProfile: CodexProfile = profile) => ({
  id: 990000 + number, environment, model: 'gpt-6.1-sol', reasoningEffort: 'high', profile: requestProfile,
  status: 'COMPLETED' as CodexStatus, userMessage: `Pedido sintético ${990000 + number}` as string | null,
  responseText: response(990000 + number) as string | null, productName: number % 2 ? 'Produto A' : 'Produto B',
  createdAt: new Date(new Date(timestamp).getTime() + number * 1_000).toISOString(),
  finishedAt: new Date(new Date(timestamp).getTime() + number * 1_000 + 500).toISOString()
});
const server = () => ({ rows: Array.from({ length: 13 }, (_, index) => row(index + 1)), failRecent: false, submitDelayMs: 0,
  calls: [] as { path: string; method: string; profile: string | null }[] });
type Server = ReturnType<typeof server>;

async function mockApi(page: Page, state: Server) {
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const requestedProfile = url.searchParams.get('profile');
    state.calls.push({ path, method: request.method(), profile: requestedProfile });
    let json: unknown = [];
    if (path === '/api/account/read') json = { connected: true, status: 'connected', executable: true };
    if (path === '/api/environments/active') json = [{ id: 1, name: environment }];
    if (path === '/api/codex/models/active') json = [{ id: 1, modelName: 'gpt-6.1-sol' }];
    if (path === '/api/products') json = [{ name: 'Produto A' }, { name: 'Produto B' }];
    if (path === '/api/codex/requests/metrics') json = {
      day: { startsAt: timestamp, requestCount: 13, interactionCount: 0, durationMs: 0 },
      salesImpactDay: { muitoBaixo: 0, baixo: 0, medio: 13, alto: 0, muitoAlto: 0, total: 13 }
    };
    const recent = [...state.rows].filter(item => item.profile === requestedProfile)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
    if (path === '/api/codex/requests') {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        const created = { ...row(Math.max(...state.rows.map(item => item.id)) - 990000 + 1),
          ...payload, status: 'PENDING' as CodexStatus, responseText: null };
        state.rows.push(created);
        if (state.submitDelayMs) await new Promise(resolve => setTimeout(resolve, state.submitDelayMs));
        return route.fulfill({ json: created });
      }
      // Faithful to CodexRequestSummary: no userMessage, responseText or execution log.
      json = { content: recent.slice(0, 20).map(({ id, environment, model, reasoningEffort, profile, status, createdAt, productName }) =>
        ({ id, environment, model, reasoningEffort, profile, status, createdAt, productName, prompt: '', requestTitle: `Resumo ${id}` })),
      totalElements: recent.length, totalPages: 1 };
    }
    if (path === '/api/codex/requests/open-batch') {
      // Old batch details must not consume a position in the recent conversation.
      json = [{ ...row(0), workBatchKey: 'test-old-batch', workBranch: 'test/old', responseText: 'Pedido antigo do lote' }];
    }
    if (path === '/api/codex/requests/recent-dialogue') {
      if (state.failRecent) return route.fulfill({ status: 503, json: { error: 'Falha sintética de consulta' } });
      json = recent.slice(0, 10);
    }
    if (/^\/api\/codex\/requests\/\d+$/.test(path)) json = state.rows.find(item => item.id === Number(path.split('/').at(-1)));
    return route.fulfill({ json });
  });
}

const dialogue = (page: Page) => page.getByLabel('Diálogo recente', { exact: true });
const assistant = (page: Page, id: number) => dialogue(page).locator(`article:has(a[href="/codex/requests/${id}"])`);
const displayedRequestIds = (page: Page) => dialogue(page).locator('article a[href^="/codex/requests/"]').evaluateAll(links =>
  links.map(link => Number(link.getAttribute('href')!.split('/').at(-1))));

for (const deviceName of ['Desktop Chrome', 'Pixel 7']) {
  test.describe(`Dez solicitações recentes — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile, hasTouch: device.hasTouch });

    for (const staleCache of [false, true]) {
      test(`restaura dez pares com storage ${staleCache ? 'desatualizado' : 'vazio'} e resumo real`, async ({ page }, testInfo) => {
        const state = server();
        state.rows.push(row(100, 'CHATGPT_CODEX'));
        // Completion time does not determine the order of requests in the dialogue.
        state.rows[3].finishedAt = '2026-10-01T23:00:00Z';
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        if (staleCache) await page.addInitScript(({ profile, environment, timestamp }) => {
          localStorage.setItem(`ai-hub:codex-chat-conversation:${profile}`, JSON.stringify([
            { id: 'old-user', role: 'user', content: 'Pedido fora do recorte', environment, createdAt: timestamp },
            { id: 'old-assistant', role: 'assistant', content: 'Cache antigo', requestId: 990001, status: 'COMPLETED', environment, createdAt: timestamp },
            { id: 'cached-user', role: 'user', content: 'Pedido desatualizado', environment, createdAt: timestamp },
            { id: 'cached-assistant', role: 'assistant', content: 'Resposta desatualizada', requestId: 990005, status: 'COMPLETED', environment, createdAt: timestamp },
            { id: 'deleted-user', role: 'user', content: 'Pedido excluído em outro computador', environment, createdAt: '2026-10-01T23:59:00Z' },
            { id: 'deleted-assistant', role: 'assistant', content: 'Cache de pedido já excluído', requestId: 991000, status: 'COMPLETED', environment, createdAt: '2026-10-01T23:59:00Z' }
          ]));
          localStorage.setItem(`ai-hub:codex-chat-read-comments:${profile}`, '["cached-assistant"]');
        }, { profile, environment, timestamp });
        await mockApi(page, state);
        await page.goto('/codex-chatgpt-mkt');
        const expected = Array.from({ length: 10 }, (_, index) => 990004 + index);
        await expect.poll(() => displayedRequestIds(page)).toEqual(expected);
        await expect(dialogue(page).locator('article')).toHaveCount(20);
        for (const id of expected) {
          await expect(dialogue(page).getByText(`Pedido sintético ${id}`, { exact: true })).toBeVisible();
          await expect(assistant(page, id)).toContainText(`Conteúdo público ${id}`);
        }
        await expect(dialogue(page)).not.toContainText('Pedido antigo do lote');
        await expect(dialogue(page)).not.toContainText('Resposta desatualizada');
        await expect(dialogue(page)).not.toContainText('Pedido excluído em outro computador');
        if (staleCache) await expect(assistant(page, 990005).getByRole('checkbox', { name: 'Lido', exact: true })).toBeChecked();
        await expect(dialogue(page).getByRole('heading', { name: 'Comentário', exact: true })).toHaveCount(10);
        await dialogue(page).screenshot({ path: testInfo.outputPath('recent-dialogue.png'), animations: 'disabled' });
        await page.reload();
        await expect.poll(() => displayedRequestIds(page)).toEqual(expected);
        expect(state.calls.filter(call => call.path.endsWith('/recent-dialogue')).every(call => call.profile === profile)).toBe(true);
        expect(state.calls.every(call => call.method === 'GET')).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
        expect(errors).toEqual([]);
      });
    }

    test('duas sessões veem estados, novas solicitações e conclusão por polling sem duplicar', async ({ page, browser }) => {
      const state = server();
      state.rows[12].status = 'RUNNING';
      state.rows[12].responseText = null;
      state.rows[11].status = 'PENDING';
      state.rows[11].responseText = null;
      state.rows[10].status = 'FAILED';
      state.rows[10].responseText = null;
      state.rows[9].status = 'CANCELLED';
      state.rows[9].responseText = null;
      state.rows[8].userMessage = null;
      state.rows[7].responseText = null;
      const otherContext = await browser.newContext({ ...device });
      try {
        const other = await otherContext.newPage();
        await mockApi(page, state);
        await mockApi(other, state);
        await page.clock.install({ time: new Date(timestamp) });
        await other.clock.install({ time: new Date(timestamp) });
        await page.goto('/codex-chatgpt-mkt');
        await other.goto('/codex-chatgpt-mkt');
        for (const view of [page, other]) {
          await expect(assistant(view, 990013)).toContainText('Em execução');
          await expect(assistant(view, 990012)).toContainText('Pendente');
          await expect(assistant(view, 990011)).toContainText('A execução falhou');
          await expect(assistant(view, 990010)).toContainText('cancelada');
          await expect(dialogue(view)).toContainText('Solicitação #990009: mensagem original indisponível.');
          await expect(assistant(view, 990008)).toContainText('Resposta ainda não disponível');
        }
        state.rows[12].status = 'COMPLETED';
        state.rows[12].responseText = response(990013);
        const next = row(14);
        next.status = 'PENDING';
        next.responseText = null;
        state.rows.push(next);
        for (const view of [page, other]) {
          await view.clock.runFor(15_001);
          await expect(assistant(view, 990013)).toContainText('Conteúdo público 990013');
          await expect(assistant(view, 990014)).toContainText('Pendente');
          await expect.poll(() => displayedRequestIds(view)).toEqual(Array.from({ length: 10 }, (_, index) => 990005 + index));
          await expect(dialogue(view).locator('article')).toHaveCount(20);
        }
        next.userMessage = 'Pedido editado no outro computador';
        next.status = 'COMPLETED';
        next.responseText = response(next.id);
        for (const view of [page, other]) {
          await view.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
          await expect(dialogue(view)).toContainText('Pedido editado no outro computador');
          await expect(assistant(view, next.id)).toContainText(`Conteúdo público ${next.id}`);
          await expect(dialogue(view).locator('article')).toHaveCount(20);
        }
        expect(state.calls.every(call => call.method === 'GET')).toBe(true);
      } finally {
        await otherContext.close();
      }
    });

    test('recupera falha sem perder o diálogo e respeita retirada, filtro e corte de contexto', async ({ page }) => {
      const state = server();
      state.failRecent = true;
      await mockApi(page, state);
      await page.goto('/codex-chatgpt-mkt');
      await expect(page.getByRole('alert')).toContainText('Não foi possível atualizar as 10 solicitações');
      await expect(dialogue(page)).toHaveCount(0);
      state.failRecent = false;
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect.poll(() => displayedRequestIds(page)).toHaveLength(10);
      state.failRecent = true;
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect.poll(() => displayedRequestIds(page)).toHaveLength(10);
      state.failRecent = false;
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await assistant(page, 990013).getByRole('checkbox', { name: 'Lido', exact: true }).check();
      await assistant(page, 990013).getByRole('button', { name: 'Retirar solicitação da tela', exact: true }).click();
      await expect(assistant(page, 990013)).toHaveCount(0);
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect(assistant(page, 990013)).toHaveCount(0);
      await page.getByRole('button', { name: 'Mostrar novamente', exact: true }).click();
      await expect(assistant(page, 990013).getByRole('checkbox', { name: 'Lido', exact: true })).toBeChecked();
      await page.getByLabel('Filtrar diálogo por produto').selectOption('Produto A');
      await expect.poll(() => displayedRequestIds(page)).toEqual([990005, 990007, 990009, 990011, 990013]);
      await page.getByLabel('Filtrar diálogo por produto').selectOption('');
      await page.getByLabel('Quantidade de mensagens mais recentes a manter no contexto').fill('8');
      page.once('dialog', prompt => prompt.accept());
      await page.getByRole('button', { name: 'Cortar contexto antigo', exact: true }).click();
      await expect(dialogue(page).locator('article')).toHaveCount(8);
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect(dialogue(page).locator('article')).toHaveCount(8);
    });
  });
}

test('envio simultâneo à consulta não duplica o par aceito pelo servidor', async ({ page }) => {
  const state = server();
  state.submitDelayMs = 1_000;
  await mockApi(page, state);
  await page.goto('/codex-chatgpt-mkt');
  await expect.poll(() => displayedRequestIds(page)).toHaveLength(10);
  await page.locator('textarea[required]').fill('Pedido enviado enquanto o histórico atualiza');
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect.poll(() => state.rows.length).toBe(14);
  await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
  await expect(assistant(page, 990014)).toBeVisible();
  await expect(page.locator('textarea[required]')).toHaveValue('');
  await expect.poll(() => displayedRequestIds(page)).toEqual(Array.from({ length: 10 }, (_, index) => 990005 + index));
  await expect(dialogue(page).locator('article')).toHaveCount(20);
});

for (const [requestProfile, path] of [
  ['CHATGPT_CODEX', '/codex-chatgpt'], ['CHATGPT_CODEX_SANDBOX', '/codex-chatgpt-sandbox']
] as const) {
  test(`consulta do diálogo mantém isolamento de perfil ${requestProfile}`, async ({ page }) => {
    const state = server();
    state.rows.push(row(100, requestProfile));
    await mockApi(page, state);
    await page.goto(path);
    await expect.poll(() => displayedRequestIds(page)).toEqual([990100]);
    expect(state.calls.filter(call => call.path.endsWith('/recent-dialogue')).every(call => call.profile === requestProfile)).toBe(true);
  });
}
