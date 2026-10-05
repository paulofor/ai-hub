import { devices, expect, test, type Page } from '@playwright/test';

const endpoint = '/api/codex/requests/marketing-products';
const productName = 'test/Oferta especial & + %';
const dialogueUrl = (name = productName) => `/codex-chatgpt-mkt/produtos/dialogo?${new URLSearchParams({ productName: name })}`;
const requests = Array.from({ length: 4 }, (_, index) => ({
  id: 990302 + index, profile: 'CHATGPT_CODEX_MKT', productName, status: 'COMPLETED',
  createdAt: `2026-10-05T${10 + index}:00:00Z`, finishedAt: `2026-10-05T${17 - index}:00:00Z`,
  userMessage: `Pedido sintético ${index + 1}\nAvaliar a evolução da oferta.`,
  responseText: index === 1 ? JSON.stringify({
    titulo: 'Oferta refinada', comentario: '**Ajustar o checkout**\n\n| Etapa | Resultado |\n| --- | --- |\n| Oferta | Validada |',
    impactoAumentoVendas: 'alto', alterouCodigoRepositorio: false, resumoCodigoPr: '', sugestaoMelhoriaAmbiente: ''
  }) : `Resposta sintética ${index + 1}\n\n**Próximo teste:** revisar o funil.`,
  executionLog: 'INTERNAL_LOG_TEST_ONLY', prompt: 'INTERNAL_PROMPT_TEST_ONLY'
}));

async function fixture(page: Page) {
  const calls: URL[] = [];
  let fail = false;
  let data: unknown[] = requests;
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    expect(route.request().method()).toBe('GET');
    if (url.pathname === `${endpoint}/dialogue`) {
      if (fail) return route.fulfill({ status: 503, json: { message: 'Falha sintética' } });
      return route.fulfill({ json: data });
    }
    if (url.pathname === endpoint) return route.fulfill({ json: {
      content: [{ productName, requestCount: 6, latestRequestAt: requests[3].createdAt, requests: {
        content: [], number: 0, totalPages: 0, totalElements: 0, first: true, last: true
      } }], number: 0, totalPages: 1, totalElements: 1, first: true, last: true
    } });
    return route.fulfill({ status: 500, json: { message: 'Consulta inesperada na fixture' } });
  });
  return { calls, fail: (value: boolean) => { fail = value; }, data: (value: unknown[]) => { data = value; } };
}

for (const device of ['desktop', 'Pixel 7', 'iPhone 15 Pro'] as const) {
  const mobile = device === 'desktop' ? null : devices[device];
  test.describe(`product dialogue ${device}`, () => {
    test.use(mobile ? {
      viewport: mobile.viewport, userAgent: mobile.userAgent, deviceScaleFactor: mobile.deviceScaleFactor,
      isMobile: mobile.isMobile, hasTouch: mobile.hasTouch
    } : { viewport: { width: 1440, height: 900 } });

    test('opens the product link and displays four chronological request/response pairs', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const api = await fixture(page);
      await page.goto('/codex-chatgpt-mkt/produtos');
      const link = page.getByRole('link', { name: `Ver diálogo de ${productName}`, exact: true });
      await expect(link).toHaveAttribute('href', dialogueUrl());
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp('/produtos/dialogo\\?'));
      await expect(page.getByRole('heading', { name: 'Diálogo do produto', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: productName, exact: true })).toBeVisible();
      const dialogue = page.getByRole('region', { name: `Diálogo de ${productName}`, exact: true });
      await expect(dialogue.getByRole('article')).toHaveCount(4);
      for (const [index, request] of requests.entries()) {
        const pair = dialogue.getByRole('article').nth(index);
        await expect(pair).toHaveAttribute('aria-label', `Solicitação #${request.id}`);
        await expect(pair.getByRole('link')).toHaveAttribute('href', `/codex/requests/${request.id}`);
        await expect(pair.getByRole('region', { name: `Usuário da solicitação #${request.id}`, exact: true })).toContainText(`Pedido sintético ${index + 1}`);
        await expect(pair.getByRole('region', { name: `Modelo da solicitação #${request.id}`, exact: true })).toContainText(index === 1 ? 'Ajustar o checkout' : `Resposta sintética ${index + 1}`);
      }
      await expect(dialogue.getByRole('article').first()).toContainText('05/10/2026, 07:00');
      await expect(dialogue.getByRole('article').first()).toContainText('05/10/2026, 14:00');
      await expect(dialogue).toContainText('Oferta refinada');
      await expect(dialogue.getByRole('table')).toContainText('Validada');
      await expect(dialogue).not.toContainText('INTERNAL_');
      await expect(dialogue).not.toContainText('"comentario"');
      expect(api.calls.filter((url) => url.pathname.endsWith('/dialogue')).every((url) => url.searchParams.get('productName') === productName)).toBe(true);
      expect(api.calls.every((url) => [endpoint, `${endpoint}/dialogue`].includes(url.pathname))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`dialogue-${device}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Escuro', exact: true }).click();
      await expect(dialogue).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.getByRole('link', { name: '← Voltar à evolução dos produtos' }).click();
      await expect(page.getByRole('heading', { name: 'Evolução dos produtos', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test('shows active and unsuccessful requests without inventing public content and refreshes responses', async ({ page }) => {
      const api = await fixture(page);
      api.data(requests.map((request, index) => ({ ...request, status: ['PENDING', 'RUNNING', 'FAILED', 'CANCELLED'][index], userMessage: index === 0 ? null : request.userMessage, responseText: null })));
      await page.goto(dialogueUrl());
      await expect(page.getByText('Mensagem original indisponível.', { exact: true })).toBeVisible();
      await expect(page.getByText('Aguardando início da execução.', { exact: true })).toBeVisible();
      await expect(page.getByText('Aguardando resposta do modelo…', { exact: true })).toBeVisible();
      await expect(page.getByText('A execução falhou. Abra os detalhes da solicitação para mais informações.', { exact: true })).toBeVisible();
      await expect(page.getByText('Solicitação cancelada. Nenhuma nova resposta será gerada.', { exact: true })).toBeVisible();
      api.data([{ ...requests[0], responseText: 'Resposta atualizada após conclusão' }, { ...requests[1], responseText: ' ' }]);
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect(page.getByRole('article')).toHaveCount(2);
      await expect(page.getByText('Resposta atualizada após conclusão', { exact: true })).toBeVisible();
      await expect(page.getByText('Resposta do modelo indisponível.', { exact: true })).toBeVisible();
      await expect(page.getByText('Aguardando resposta do modelo…', { exact: true })).toHaveCount(0);
    });

    test('recovers API failures and handles empty or invalid product selections', async ({ page }) => {
      const api = await fixture(page);
      api.fail(true);
      await page.goto(dialogueUrl());
      await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o diálogo deste produto.');
      await expect(page.getByRole('article')).toHaveCount(0);
      api.fail(false);
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
      await expect(page.getByRole('article')).toHaveCount(4);
      api.data([]);
      await page.getByRole('button', { name: 'Atualizar diálogo', exact: true }).click();
      await expect(page.getByText('Este produto ainda não tem solicitações no perfil Codex ChatGPT MKT.', { exact: true })).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(0);
      api.calls.length = 0;
      for (const url of ['/codex-chatgpt-mkt/produtos/dialogo', dialogueUrl(' '), dialogueUrl('x'.repeat(151))]) {
        await page.goto(url);
        await expect(page.getByRole('alert')).toContainText('Selecione um produto na tela de evolução dos produtos');
        await expect(page.getByRole('button', { name: 'Atualizar diálogo', exact: true })).toHaveCount(0);
      }
      expect(api.calls).toEqual([]);
    });

    if (device === 'desktop') test('cancels a delayed dialogue when returning to products', async ({ page }) => {
      const api = await fixture(page);
      let release!: () => void;
      const delay = new Promise<void>((resolve) => { release = resolve; });
      await page.route((url) => url.pathname === `${endpoint}/dialogue`, async (route) => {
        await delay;
        await route.fulfill({ json: requests }).catch(() => {});
      });
      const started = page.waitForRequest((request) => new URL(request.url()).pathname === `${endpoint}/dialogue`);
      await page.goto(dialogueUrl());
      await started;
      await expect(page.getByRole('status')).toContainText('Carregando diálogo');
      const cancelled = page.waitForEvent('requestfailed', { predicate: (request) => new URL(request.url()).pathname === `${endpoint}/dialogue` });
      await page.getByRole('link', { name: '← Voltar à evolução dos produtos' }).click();
      await cancelled;
      release();
      await expect(page.getByRole('heading', { name: 'Evolução dos produtos', exact: true })).toBeVisible();
      expect(api.calls.every((url) => [endpoint, `${endpoint}/dialogue`].includes(url.pathname))).toBe(true);
    });
  });
}
