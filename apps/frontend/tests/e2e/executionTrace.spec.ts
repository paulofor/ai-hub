import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

const at = '2026-10-03T12:00:00Z';
test.use({ browserName: 'chromium' });
const plans = ['running', 'failed', 'running', 'completed'].map((status, index) => ({
  id: `plan-${index + 1}`, turnId: index < 2 ? 'turn-trace-1' : 'turn-trace-2', receivedAt: at,
  steps: [{ step: 'Validar o fluxo completo', status }, { step: 'Revisar a entrega', status: 'pending' }],
}));
const syntheticTrace = { version: 1, revision: 10, droppedEvents: 0, droppedPlans: 0, plans, events: [
  { id: 'cmd-failure', sequence: 1, turnId: 'turn-trace-1', itemId: 'test-command', planId: 'plan-1', stepIndex: 0, kind: 'command',
    label: 'Executar comando', status: 'failed', receivedAt: at, finishedAt: at, durationMs: 1200, durationSource: 'provider',
    result: 'Comando encerrado com código 1.', details: { command: 'npm test', output: 'Teste falhou. token=[oculto]' }, evidence: [] },
  { id: 'turn-failure', sequence: 2, turnId: 'turn-trace-1', kind: 'turn', label: 'Encerramento do turno', status: 'failed', receivedAt: at, result: 'Turno interrompido.', evidence: [] },
  { id: 'retry', sequence: 3, turnId: 'turn-trace-2', kind: 'turn', label: 'Retomada da execução', status: 'completed', receivedAt: at, result: 'Nova tentativa na mesma solicitação; resultados anteriores preservados.', evidence: [] },
  { id: 'cmd-success', sequence: 4, turnId: 'turn-trace-2', itemId: 'test-command', planId: 'plan-3', stepIndex: 0, kind: 'command',
    label: 'Executar comando', status: 'completed', receivedAt: at, finishedAt: at, durationMs: 1200, durationSource: 'provider',
    result: 'Comando encerrado com código 0.', details: { command: 'npm test', output: '12 testes aprovados.' }, evidence: [{ label: 'Abrir referência observada', url: 'https://github.com/paulofor/ai-hub/actions/runs/123' }] },
  { id: 'file', sequence: 5, turnId: 'turn-trace-2', planId: 'plan-3', stepIndex: 0, kind: 'file', label: 'Alterar arquivos', status: 'completed', receivedAt: at,
    result: '1 arquivo(s) informado(s) pelo executor.', details: { files: ['apps/frontend/src/lib/executionTrace.ts'] },
    evidence: [{ label: 'Arquivo: executionTrace.ts', url: 'https://github.com/paulofor/ai-hub/blob/main/apps/frontend/src/lib/executionTrace.ts' }] },
] };
const generated = process.env.EXECUTION_TRACE_E2E_DETAIL;
const detail = generated ? JSON.parse(readFileSync(generated, 'utf8')) : {
  id: 990010, environment: 'sandbox.local', model: 'gpt-6-astra', profile: 'CHATGPT_CODEX_MKT', status: 'COMPLETED',
  prompt: 'Teste local do trace', createdAt: at, responseText: 'Resumo Codex App Server', reasoningSummary: 'Resumo público validado por JSON-RPC.', executionTrace: syntheticTrace,
};
const trace = typeof detail.executionTrace === 'string' ? JSON.parse(detail.executionTrace) : detail.executionTrace;

for (const deviceName of ['Desktop Chrome', 'iPhone 15 Pro']) {
  test.describe(`Acompanhamento da execução — ${deviceName}`, () => {
    const device = devices[deviceName];
    test.use({ viewport: device.viewport, userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });

    test('checklist, evidências, falhas, retomada e resumo são separados no detalhe persistido', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/codex/requests/*/{previous,next}', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route(`**/api/codex/requests/${detail.id}`, (route) => route.fulfill({ json: detail }));
      await page.goto(`/codex/requests/${detail.id}`);
      const checklist = page.getByTestId('execution-checklist');
      await expect(checklist).toContainText('Validar o fluxo completo');
      await expect(checklist).toContainText('Concluído');
      await expect(checklist).toContainText('Pendente');
      await expect(checklist).toContainText('resultado(s) observado(s) durante esta etapa');
      await expect(checklist).toContainText('Sem resultado observado para esta etapa');
      const timeline = page.getByTestId('execution-timeline');
      await expect(timeline).toContainText('Retomada da execução');
      await expect(timeline).toContainText('Comando encerrado com código 1.');
      await expect(timeline).toContainText('Comando encerrado com código 0.');
      await expect(timeline).toContainText('1,2 s (informado pelo executor)');
      await expect(timeline.locator(':scope > li').filter({ hasText: 'Comando encerrado com código 0.' })).toHaveCount(1);
      const command = timeline.locator(':scope > li').filter({ hasText: 'Comando encerrado com código 0.' });
      await expect(command.locator('pre').last()).toBeHidden();
      await command.getByText('Detalhes técnicos', { exact: true }).click();
      await expect(command).toContainText('12 testes aprovados.');
      await expect(command.locator('pre').last()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Abrir referência observada' }).first()).toHaveAttribute('href', /\/actions\/runs\/123/);
      await expect(page.getByRole('link', { name: 'Arquivo: executionTrace.ts' })).toHaveAttribute('href', /\/blob\//);
      const evidence = checklist.getByRole('link').first();
      const anchor = await evidence.getAttribute('href');
      await evidence.click();
      expect(page.url()).toContain('#trace-event-');
      const target = page.locator(`[id="${anchor!.slice(1)}"]`);
      await expect.poll(async () => (await target.boundingBox())!.y).toBeGreaterThanOrEqual(70);
      await expect(checklist).toContainText('com falha');
      const history = page.getByTestId('execution-plan-history');
      await history.locator('summary').click();
      await expect(history.getByText(/Falha$/).first()).toBeVisible();
      await expect(page.getByTestId('codex-reasoning-summary')).toBeHidden();
      await page.getByText('Resumo público complementar', { exact: true }).click();
      await expect(page.getByTestId('codex-reasoning-summary')).toHaveText(detail.reasoningSummary);
      await expect(page.getByTestId('codex-reasoning-summary')).not.toContainText('Validar o fluxo completo');
      await expect(page.getByTestId('codex-response')).toContainText(detail.responseText);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath('execution-trace.png'), fullPage: true });
      expect(errors).toEqual([]);
    });

    test('polling mostra atividade atual e resultado, preservando solicitação e métricas', async ({ page }) => {
      await page.clock.install();
      let finished = false;
      const live = structuredClone(trace);
      live.plans = [live.plans[0]];
      live.events = [{ ...live.events.find((event: { kind: string }) => event.kind === 'command'), status: 'running', result: undefined, finishedAt: undefined, durationMs: undefined }];
      await page.route('**/api/codex/requests/*/{previous,next}', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/codex/requests/990011', (route) => route.fulfill({ json: {
        ...detail, id: 990011, status: finished ? 'COMPLETED' : 'RUNNING', executionTrace: finished ? trace : live, totalTokens: 42,
      } }));
      await page.goto('/codex/requests/990011');
      await expect(page.getByTestId('codex-execution-trace')).toContainText('Em execução: Executar comando');
      await expect(page.getByTestId('execution-checklist')).toContainText('Executando');
      await expect(page.getByTestId('execution-timeline')).toContainText('Aguardando resultado da operação.');
      finished = true;
      await page.clock.fastForward(16_000);
      await expect(page.getByTestId('execution-timeline')).toContainText('Comando encerrado com código 0.');
      await expect(page.getByText('Em execução: Executar comando', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('execution-checklist')).toContainText('Concluído');
      await expect(page.getByTestId('codex-response')).toContainText(detail.responseText);
    });

    test('pedidos antigos separam o prefixo de checklist sem inventar histórico', async ({ page }) => {
      await page.route('**/api/codex/requests/*/{previous,next}', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/codex/requests/990012', (route) => route.fulfill({ json: {
        ...detail, id: 990012, executionTrace: undefined,
        reasoningSummary: '**Objetivos**\n- [x] Verificar a execução\n- [ ] Validar a entrega\n\nResumo antigo preservado.',
      } }));
      await page.goto('/codex/requests/990012');
      await expect(page.getByTestId('execution-checklist')).toContainText('Verificar a execução');
      await expect(page.getByText('Checklist antigo: o registro não distingue pendente de executando.')).toBeVisible();
      await expect(page.getByTestId('codex-execution-trace')).toContainText('Eventos estruturados indisponíveis');
      await expect(page.getByTestId('codex-reasoning-summary')).toHaveText('Resumo antigo preservado.');
    });

    test('payload inválido, ausência de resumo e referência insegura não quebram o painel', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const unsafe = structuredClone(trace);
      unsafe.events = [null, {}, ...unsafe.events, { ...unsafe.events[0], id: 'unsafe', label: '<script>alert(1)</script>', evidence: [
        { label: 'Referência insegura', url: 'javascript:alert(1)' }, { label: 'URL com senha', url: 'https://user:pass@example.test' },
      ] }];
      await page.route('**/api/codex/requests/*/{previous,next}', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/codex/requests/990013', (route) => route.fulfill({ json: { ...detail, id: 990013, reasoningSummary: undefined, executionTrace: unsafe } }));
      await page.goto('/codex/requests/990013');
      await expect(page.getByTestId('execution-timeline')).toContainText('<script>alert(1)</script>');
      await expect(page.getByRole('link', { name: 'Referência insegura' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'URL com senha' })).toHaveCount(0);
      await page.getByText('Resumo público complementar', { exact: true }).click();
      await expect(page.getByTestId('codex-reasoning-summary')).toHaveText('—');
      expect(errors).toEqual([]);
    });

    test('histórico limitado e eventos anteriores permanecem acessíveis', async ({ page }) => {
      const many = structuredClone(trace);
      many.events = Array.from({ length: 45 }, (_, index) => ({ ...many.events[0], id: `event-${index}`, sequence: index, label: `Operação ${index}` }));
      many.droppedEvents = 3;
      many.droppedPlans = 1;
      await page.route('**/api/codex/requests/*/{previous,next}', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/codex/requests/990014', (route) => route.fulfill({ json: { ...detail, id: 990014, executionTrace: JSON.stringify(many) } }));
      await page.goto('/codex/requests/990014');
      await expect(page.getByTestId('codex-execution-trace')).toContainText('3 evento(s) e 1 versão(ões) anterior(es) omitidos');
      await expect(page.getByTestId('execution-timeline').locator(':scope > li')).toHaveCount(40);
      await page.getByRole('button', { name: 'Mostrar eventos anteriores (5)' }).click();
      await expect(page.getByTestId('execution-timeline').locator(':scope > li')).toHaveCount(45);
      await expect(page.getByText('Operação 0', { exact: true })).toBeVisible();
    });
  });
}
