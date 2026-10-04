import { devices, expect, test, type Page } from '@playwright/test';

const endpoint = '/api/codex/requests/marketing-products';
const productName = 'test/Oferta especial & + %';
const paginated = <T>(content: T[], number = 0, totalElements = content.length) => ({
  content, number, size: 15, totalElements, totalPages: Math.ceil(totalElements / 15),
  first: number === 0, last: number >= Math.ceil(totalElements / 15) - 1
});
const requests = Array.from({ length: 17 }, (_, index) => ({
  id: 990200 - index,
  status: index === 2 ? 'PENDING' : index === 3 ? 'RUNNING' : index === 4 ? 'FAILED' : index === 5 ? 'CANCELLED' : 'COMPLETED',
  createdAt: '2026-10-04T01:00:00Z',
  startedAt: index === 2 || index === 4 ? null : '2026-10-04T01:05:00Z',
  finishedAt: index === 2 || index === 3 || index === 4 ? null : '2026-10-04T01:07:00Z',
  durationMs: index === 1 ? 0 : index === 2 || index === 3 || index === 4 ? null : 120_000,
  processNumber: index === 0 ? '2.1' : index === 1 ? '1' : null,
  processText: index === 0 ? 'Otimizar checkout' : index === 1 ? 'Validar oferta' : null,
  cost: index === 0 ? 0.012345 : index === 1 ? 0 : null,
  totalTokens: index === 0 ? 9_876_543 : index === 1 ? 0 : null
}));
const products = [
  { productName, requestCount: 17, latestRequestAt: '2026-10-04T01:00:00Z', requests: paginated(requests.slice(0, 15), 0, 17) },
  { productName: 'test/Produto vazio', requestCount: 0, latestRequestAt: null, requests: paginated([]) },
  ...Array.from({ length: 14 }, (_, index) => ({ productName: `test/Produto ${index}`, requestCount: 0, latestRequestAt: null, requests: paginated([]) }))
];

async function fixture(page: Page) {
  const calls: URL[] = [];
  let productFailure = false;
  let requestFailure = false;
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    if (url.pathname === endpoint) {
      if (productFailure) return route.fulfill({ status: 503, json: { message: 'Falha sintética' } });
      const number = Number(url.searchParams.get('page') ?? 0);
      return route.fulfill({ json: paginated(products.slice(number * 15, (number + 1) * 15), number, 16) });
    }
    if (url.pathname === `${endpoint}/requests`) {
      if (requestFailure) return route.fulfill({ status: 503, json: { message: 'Falha sintética do card' } });
      const number = Number(url.searchParams.get('page') ?? 0);
      return route.fulfill({ json: paginated(requests.slice(number * 15, (number + 1) * 15), number, 17) });
    }
    return route.fulfill({ status: 500, json: { message: 'Consulta inesperada na fixture' } });
  });
  return {
    calls,
    failProducts: (value: boolean) => { productFailure = value; },
    failRequests: (value: boolean) => { requestFailure = value; }
  };
}

for (const device of ['desktop', 'Pixel 7', 'iPhone 15 Pro'] as const) {
  const mobile = device === 'desktop' ? null : devices[device];
  test.describe(`product evolution ${device}`, () => {
    test.use(mobile ? {
      viewport: mobile.viewport, userAgent: mobile.userAgent, deviceScaleFactor: mobile.deviceScaleFactor,
      isMobile: mobile.isMobile, hasTouch: mobile.hasTouch
    } : { viewport: { width: 1440, height: 900 } });

    test('opens the MKT menu and shows real fields, process history and fifteen products', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const { calls } = await fixture(page);
      await page.goto('/codex-chatgpt-mkt/produtos');
      if (mobile) await page.getByRole('button', { name: 'Abrir menu' }).click();
      const menu = page.getByRole('link', { name: 'Evolução dos produtos', exact: true });
      await expect(menu).toHaveAttribute('href', '/codex-chatgpt-mkt/produtos');
      await menu.click();
      if (mobile) await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('heading', { name: 'Evolução dos produtos' })).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(15);
      const card = page.getByRole('article', { name: `Produto ${productName}`, exact: true });
      await expect(card).toContainText('17 solicitações MKT');
      const rows = card.getByRole('row');
      await expect(rows).toHaveCount(16);
      await expect(rows.nth(1).getByRole('link')).toHaveAttribute('href', '/codex/requests/990200');
      await expect(rows.nth(1)).toContainText('03/10/2026, 22:05');
      await expect(rows.nth(1)).toContainText('03/10/2026, 22:07');
      await expect(rows.nth(1).getByRole('cell').nth(2)).toHaveText('2min');
      await expect(rows.nth(1).getByRole('cell').nth(3)).toContainText('2.1');
      await expect(rows.nth(1)).toContainText('Otimizar checkout');
      await expect(rows.nth(2).getByRole('cell').nth(3)).toContainText('Validar oferta');
      await expect(rows.nth(1).getByRole('cell').nth(4)).toContainText('0,012345');
      await expect(rows.nth(1).getByRole('cell').nth(5)).toHaveText('9.876.543');
      await expect(rows.nth(2).getByRole('cell').nth(2)).toHaveText('0min');
      await expect(rows.nth(2).getByRole('cell').nth(4)).toContainText('0,000000');
      await expect(rows.nth(2).getByRole('cell').nth(5)).toHaveText('0');
      await expect(rows.nth(3)).toContainText('Aguardando início');
      await expect(rows.nth(3)).toContainText('Aguardando término');
      await expect(rows.nth(3).getByRole('cell').nth(5)).toHaveText('Não informado');
      await expect(rows.nth(3)).toContainText('Sem processo selecionado');
      await expect(rows.nth(4)).toContainText('Em execução');
      await expect(rows.nth(5)).toContainText('Não informado');
      await expect(rows.nth(6)).toContainText('Cancelada');
      await expect(page.getByRole('article', { name: 'Produto test/Produto vazio', exact: true })).toContainText('ainda não tem solicitações no perfil Codex ChatGPT MKT');
      expect(calls.length).toBeGreaterThan(0);
      expect([...new Set(calls.map((url) => url.pathname))]).toEqual([endpoint]);
      expect(calls.every((url) => url.searchParams.get('size') === '15')).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`products-${device}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Escuro', exact: true }).click();
      if (mobile) {
        const region = card.getByRole('region');
        await region.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        await expect(rows.nth(1).getByRole('cell').nth(5)).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      }
      expect(errors).toEqual([]);
    });

    test('paginates histories independently and reloads updated data', async ({ page }) => {
      const { calls } = await fixture(page);
      await page.goto('/codex-chatgpt-mkt/produtos');
      const card = page.getByRole('article', { name: `Produto ${productName}`, exact: true });
      const historyPagination = card.getByRole('navigation', { name: `Paginação das solicitações de ${productName}` });
      await expect(historyPagination.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      await historyPagination.getByRole('button', { name: 'Próxima' }).click();
      await expect(card.getByRole('row')).toHaveCount(3);
      await expect(card.getByRole('link').first()).toHaveText('#990185');
      await expect(historyPagination).toContainText('Página 2 de 2');
      await expect(historyPagination.getByRole('button', { name: 'Próxima' })).toBeDisabled();
      expect(calls.find((url) => url.pathname.endsWith('/requests'))?.searchParams.get('productName')).toBe(productName);
      await historyPagination.getByRole('button', { name: 'Anterior' }).click();
      await expect(card.getByRole('row')).toHaveCount(16);
      const productPagination = page.getByRole('navigation', { name: 'Paginação dos produtos', exact: true });
      await productPagination.getByRole('button', { name: 'Próxima' }).click();
      await expect(page.getByRole('article')).toHaveCount(1);
      await expect(productPagination).toContainText('Página 2 de 2');
      await expect(productPagination.getByRole('button', { name: 'Próxima' })).toBeDisabled();
      await productPagination.getByRole('button', { name: 'Anterior' }).click();
      await expect(page.getByRole('article')).toHaveCount(15);
      await expect(card.getByRole('row')).toHaveCount(16);
      await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
      await expect(card.getByRole('row')).toHaveCount(16);
      expect(calls.every((url) => [endpoint, `${endpoint}/requests`].includes(url.pathname))).toBe(true);
    });

    test('recovers product and card failures without replacing missing metrics with zero', async ({ page }) => {
      const api = await fixture(page);
      api.failProducts(true);
      await page.goto('/codex-chatgpt-mkt/produtos');
      await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a evolução dos produtos');
      await expect(page.getByRole('article')).toHaveCount(0);
      api.failProducts(false);
      await page.getByRole('button', { name: 'Tentar novamente' }).click();
      const card = page.getByRole('article', { name: `Produto ${productName}`, exact: true });
      await expect(card).toBeVisible();
      api.failRequests(true);
      await card.getByRole('button', { name: 'Próxima' }).click();
      await expect(card.getByRole('alert')).toContainText('Não foi possível carregar as solicitações deste produto');
      await expect(card.getByRole('table')).toHaveCount(0);
      api.failRequests(false);
      await card.getByRole('button', { name: 'Tentar novamente' }).click();
      await expect(card.getByRole('row')).toHaveCount(3);
      await expect(card.getByRole('row').nth(1).getByRole('cell').nth(5)).toHaveText('Não informado');
    });

    test('handles an empty catalog and history', async ({ page }) => {
      await page.route(`**${endpoint}?**`, (route) => route.fulfill({ json: paginated([]) }));
      await page.goto('/codex-chatgpt-mkt/produtos');
      await expect(page.getByText('Nenhum produto encontrado.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Cadastrar produto', exact: true })).toHaveAttribute('href', '/products');
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Paginação dos produtos' })).toHaveCount(0);
    });

    if (device === 'desktop') test('discards a delayed card response when refreshing the whole page', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await fixture(page);
      let release!: () => void;
      const delayed = new Promise<void>((resolve) => { release = resolve; });
      await page.route((url) => url.pathname === `${endpoint}/requests`, async (route) => {
        await delayed;
        await route.fulfill({ json: paginated(requests.slice(15), 1, 17) }).catch(() => {});
      });
      await page.goto('/codex-chatgpt-mkt/produtos');
      const card = page.getByRole('article', { name: `Produto ${productName}`, exact: true });
      const started = page.waitForRequest((request) => new URL(request.url()).pathname === `${endpoint}/requests`);
      await card.getByRole('button', { name: 'Próxima' }).click();
      await started;
      await expect(card.getByRole('status')).toContainText('Carregando solicitações');
      await page.route((url) => url.pathname === endpoint, (route) => route.fulfill({ json: paginated([
        { ...products[0], requests: paginated([{ ...requests[0], totalTokens: 555 }]) }
      ]) }));
      const cancelled = page.waitForEvent('requestfailed', { predicate: (request) => new URL(request.url()).pathname === `${endpoint}/requests` });
      await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
      await cancelled;
      await expect(card.getByRole('row')).toHaveCount(2);
      await expect(card.getByRole('row').nth(1).getByRole('cell').nth(5)).toHaveText('555');
      release();
      await expect(card.getByRole('row').nth(1).getByRole('link')).toHaveText('#990200');
      await expect(card.getByRole('alert')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
