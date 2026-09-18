import { test, expect, devices } from '@playwright/test';
import { buildPostPrContinuationPrompt } from '../../src/lib/deliveryInstructions';

const profiles = [
  { route: '/codex-chatgpt', profile: 'CHATGPT_CODEX', placeholder: /Digite sua mensagem para o modelo/ },
  { route: '/codex-chatgpt-mkt', profile: 'CHATGPT_CODEX_MKT', placeholder: /Digite sua solicitação de análise de marketing/ },
  { route: '/codex-chatgpt-sandbox', profile: 'CHATGPT_CODEX_SANDBOX', placeholder: /Digite o que o modelo deve executar na sandbox/ }
];

for (const mobile of [false, true]) {
  test.describe(mobile ? 'delivery mobile' : 'delivery desktop', () => {
    if (mobile) {
      const device = devices['iPhone 15 Pro'];
      test.use({
        viewport: device.viewport,
        userAgent: device.userAgent,
        deviceScaleFactor: device.deviceScaleFactor,
        isMobile: device.isMobile,
        hasTouch: device.hasTouch
      });
    }
    for (const profile of profiles) {
      test(`sends delivery policy for ${profile.profile}`, async ({ page }) => {
        // No request can reach a real backend or use production data.
        await page.route(/^http:\/\/127\.0\.0\.1:8082\/api\//, (route) => route.fulfill({ json: [] }));
        await page.route('**/api/account/read', (route) => route.fulfill({ json: { connected: true, status: 'connected', executable: true } }));
        await page.route('**/api/environments', (route) => route.fulfill({ json: [{ id: 1, name: 'test/delivery@main' }] }));
        await page.route('**/api/account/models', (route) => route.fulfill({ json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }] }));
        await page.route('**/api/codex/requests/metrics?**', (route) => route.fulfill({ json: { day: { requestCount: 0, interactionCount: 0, durationMs: 0 } } }));
        let submittedPrompt = '';
        await page.route('**/api/codex/requests', (route) => {
          const payload = route.request().postDataJSON() as { prompt: string; profile: string };
          expect(payload.profile).toBe(profile.profile);
          submittedPrompt = payload.prompt;
          return route.fulfill({ json: { id: 9901, profile: profile.profile, status: 'PENDING', createdAt: '2026-09-18T12:00:00Z' } });
        });
        await page.route('**/api/codex/requests?**', (route) => route.fulfill({ json: { content: [] } }));
        await page.goto(profile.route);
        await page.getByPlaceholder(profile.placeholder).fill('Implemente a alteração solicitada.');
        await page.getByRole('button', { name: 'Enviar mensagem' }).click();
        await expect.poll(() => submittedPrompt).toContain('Última mensagem do usuário:\nImplemente a alteração solicitada.');
        if (profile.profile === 'CHATGPT_CODEX_SANDBOX') {
          expect(submittedPrompt).toContain('sem PR, merge ou deploy');
          expect(submittedPrompt).not.toContain('Orientação de entrega para tarefas com código em repositório');
        } else {
          expect(submittedPrompt).toContain('criar ou atualizar o Pull Request');
          expect(submittedPrompt).toContain('revisar e aprovar o PR quando a identidade autenticada tiver permissão');
          expect(submittedPrompt).toContain('merge na branch main');
          expect(submittedPrompt).toContain('revise o diff e os critérios de aceite antes de commit/push');
          expect(submittedPrompt).toContain('deploys encadeados');
          expect(submittedPrompt).toContain('se já houve merge, abra um PR de correção');
          expect(submittedPrompt).toContain('Não finalize como concluído enquanto houver workflow ou deploy esperado ausente');
          expect(submittedPrompt).toContain('versão/saúde publicada verificada');
          expect(submittedPrompt).toContain('não tente aprovar o próprio PR como autor');
          expect(submittedPrompt).toContain('restrições explícitas do usuário');
          expect(submittedPrompt).toContain('análises sem alterações não exigem PR');
          expect(submittedPrompt).not.toMatch(/Não crie Pull Request até|Só crie ou prepare Pull Request quando|Pull Request executado pelo usuário|avise o usuário e aguarde o deploy/);
        }
      });
    }
  });
}

test('post-PR continuation requires real reviews and delivery evidence', () => {
  const prompt = buildPostPrContinuationPrompt('https://github.com/test/delivery/pull/42', 'test/delivery@main');
  expect(prompt).toContain('https://github.com/test/delivery/pull/42');
  expect(prompt).toContain('Ambiente/repositório selecionado: test/delivery@main');
  expect(prompt).toContain('consulte as revisões reais no GitHub, sem presumir aprovação');
  expect(prompt).toContain('Prossiga com revisão, aprovação permitida, merge');
  expect(prompt).toContain('todos os workflows/jobs obrigatórios e deploys previstos concluídos com sucesso');
  expect(buildPostPrContinuationPrompt()).toContain('O PR do lote já foi solicitado.');
  expect(buildPostPrContinuationPrompt()).not.toContain('undefined');
});
