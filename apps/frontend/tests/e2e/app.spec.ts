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

  const accumulatedCodeNotice = page.getByText('Código acumulado para merge: 1 solicitação(ões) concluída(s) neste lote ainda precisam passar por PR antes do merge.');
  const requestPrButton = page.getByRole('button', { name: /Pedir PR Código pendente/ });
  await expect(accumulatedCodeNotice).toBeVisible();
  await expect(accumulatedCodeNotice).toHaveClass(/bg-indigo-50/);
  await expect(requestPrButton).toBeEnabled();
  await expect(requestPrButton).toHaveClass(/border-indigo-500/);
  await expect(requestPrButton.getByText('Código pendente')).toHaveClass(/bg-indigo-200/);
});

test('renders structured model JSON as cards in the default ChatGPT dialog', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/ai-hub@main' }] });
  });
  await page.route('**/api/account/models', async (route) => {
    await route.fulfill({ json: [{ id: 'gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5' }] });
  });
  await page.route('**/api/codex/requests/metrics?**', async (route) => {
    await route.fulfill({ json: { day: { startsAt: '2026-07-26T00:00:00Z', requestCount: 1, interactionCount: 1, durationMs: 1000 } } });
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
        id: 'assistant-structured-default',
        role: 'assistant',
        content: JSON.stringify({
          titulo: 'Comentários lidos no MKT',
          comentario: 'Implementado nos cards de comentário do `codex-chatgpt-mkt`.',
          impactoAumentoVendas: 'medio',
          alterouCodigoRepositorio: true,
          resumoCodigoPr: 'Adiciona marcação visual de leitura nos comentários MKT.',
          sugestaoMelhoriaAmbiente: 'Expor o checkout Git ativo na interface.'
        }),
        createdAt: '2026-07-26T12:00:00Z'
      }
    ]));
  });

  await page.goto('/codex-chatgpt');

  const modelArticle = page.getByRole('article').filter({ hasText: 'Comentários lidos no MKT' });
  await expect(modelArticle.getByText('Título')).toBeVisible();
  await expect(modelArticle.getByRole('heading', { name: 'Comentário' })).toBeVisible();
  await expect(modelArticle.getByText('Implementado nos cards de comentário do')).toBeVisible();
  await expect(modelArticle.getByText('Gerou código')).toBeVisible();
  await expect(modelArticle.getByText('Sugestão de melhoria para o ambiente')).toBeVisible();
  await expect(modelArticle.getByText('{"titulo"')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Lido' })).toHaveCount(0);
});

test('request PR button only uses the active dialog profile batch', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/marketing-hub@main' }] });
  });
  await page.route('**/api/account/models', async (route) => {
    await route.fulfill({ json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }] });
  });
  await page.route('**/api/codex/requests/metrics?**', async (route) => {
    await route.fulfill({ json: { day: { startsAt: '2026-07-24T00:00:00Z', requestCount: 2, interactionCount: 2, durationMs: 2000 } } });
  });
  await page.route('**/api/codex/conversations?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/prompt-hints?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/products', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/codex/requests?**', async (route) => {
    await route.fulfill({
      json: {
        content: [
          {
            id: 601,
            environment: 'paulofor/marketing-hub@main',
            model: 'gpt-5',
            version: 'aihub-6',
            profile: 'CHATGPT_CODEX',
            prompt: 'Criar arquivo tecnico',
            status: 'COMPLETED',
            createdAt: '2026-07-24T12:00:00Z',
            workBatchKey: 'ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex'
          },
          {
            id: 602,
            environment: 'paulofor/marketing-hub@main',
            model: 'gpt-5',
            version: 'aihub-6',
            profile: 'CHATGPT_CODEX_MKT',
            prompt: 'Criar docs/aihub-pedir-pr-mkt-test.md',
            status: 'COMPLETED',
            createdAt: '2026-07-24T12:01:00Z',
            responseText: JSON.stringify({
              titulo: 'Arquivo criado',
              comentario: 'Implementado.',
              alterouCodigoRepositorio: true,
              resumoCodigoPr: 'Cria arquivo de teste para o fluxo Pedir PR do MKT.',
              sugestaoMelhoriaAmbiente: ''
            }),
            workBatchKey: 'ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt'
          }
        ]
      }
    });
  });
  let requestedPrId: string | null = null;
  await page.route('**/api/codex/requests/*/create-pr', async (route) => {
    requestedPrId = route.request().url().match(/requests\/(\d+)\/create-pr/)?.[1] ?? null;
    await route.fulfill({
      json: {
        url: 'https://github.com/paulofor/marketing-hub/pull/602',
        title: 'AI Hub: lote Codex #602'
      }
    });
  });

  await page.goto('/codex-chatgpt-mkt');

  await expect(page.getByText('ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt')).toBeVisible();
  await expect(page.getByText('ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Pedir PR Código pendente/ }).click();
  await expect(page.getByText('PR solicitado:')).toBeVisible();
  const prFeedMarker = page.getByRole('article').filter({ hasText: 'Pedido de PR registrado no lote.' });
  await expect(prFeedMarker.getByText(/Sistema · \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expect(prFeedMarker.getByText('Pedido de PR registrado no lote.')).toBeVisible();
  await expect(prFeedMarker.getByRole('link', { name: 'AI Hub: lote Codex #602' })).toHaveAttribute('href', 'https://github.com/paulofor/marketing-hub/pull/602');
  expect(requestedPrId).toBe('602');
});

test('default dialog does not enable PR from a marketing-only batch', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/marketing-hub@main' }] });
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
            id: 602,
            environment: 'paulofor/marketing-hub@main',
            model: 'gpt-5',
            version: 'aihub-6',
            profile: 'CHATGPT_CODEX_MKT',
            prompt: 'Criar docs/aihub-pedir-pr-mkt-test.md',
            status: 'COMPLETED',
            createdAt: '2026-07-24T12:01:00Z',
            workBatchKey: 'ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt'
          }
        ]
      }
    });
  });

  await page.goto('/codex-chatgpt');

  await expect(page.getByText('Nenhum lote aberto para o ambiente selecionado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedir PR' })).toBeDisabled();
});

test('sandbox dialog does not render the request PR button', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/marketing-hub@main' }] });
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

  await page.goto('/codex-chatgpt-sandbox');

  await expect(page.getByText('Ambiente temporário: sandbox')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pedir PR/ })).toHaveCount(0);
});

test('sends selected prompt hint phrases in the ChatGPT request prompt', async ({ page }) => {
  await page.route('**/api/account/read', (route) => route.fulfill({
    json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
  }));
  await page.route('**/api/environments', (route) => route.fulfill({
    json: [{ id: 1, name: 'paulofor/marketing-hub@main' }]
  }));
  await page.route('**/api/account/models', (route) => route.fulfill({
    json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }]
  }));
  await page.route('**/api/codex/requests/metrics?**', (route) => route.fulfill({
    json: { day: { startsAt: '2026-07-27T00:00:00Z', requestCount: 0, interactionCount: 0, durationMs: 0 } }
  }));
  await page.route('**/api/codex/conversations?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/prompt-hints?**', (route) => route.fulfill({
    json: [
      { id: 1, label: 'Arquitetura', phrase: 'Manter o padrao de arquitetura definido.', environmentId: null },
      { id: 2, label: 'Documento Estrada', phrase: 'Leia e use como base o documento estrada.', environmentId: 1, environmentName: 'paulofor/marketing-hub@main' },
      { id: 3, label: 'Lições Aprendidas', phrase: 'Use as licoes aprendidas dos experimentos finalizados.', type: 'prompt', environmentId: 1, environmentName: 'paulofor/marketing-hub@main' },
      { id: 4, label: 'Texto editável', phrase: 'Texto inicial para editar antes de enviar.', type: 'text', environmentId: 1, environmentName: 'paulofor/marketing-hub@main' }
    ]
  }));

  let createdRequestPrompt = '';
  await page.route('**/api/codex/requests', async (route) => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON() as { prompt?: string };
      createdRequestPrompt = payload.prompt ?? '';
      await route.fulfill({
        json: {
          id: 777,
          environment: 'paulofor/marketing-hub@main',
          model: 'gpt-5',
          version: 'aihub-6',
          profile: 'CHATGPT_CODEX_MKT',
          prompt: createdRequestPrompt,
          status: 'PENDING',
          createdAt: '2026-07-27T14:00:00Z'
        }
      });
      return;
    }
    await route.fulfill({ json: { content: [] } });
  });
  await page.route('**/api/codex/requests?**', (route) => route.fulfill({ json: { content: [] } }));
  await page.route('**/api/codex/requests/777', (route) => route.fulfill({
    json: {
      id: 777,
      environment: 'paulofor/marketing-hub@main',
      model: 'gpt-5',
      version: 'aihub-6',
      profile: 'CHATGPT_CODEX_MKT',
      prompt: createdRequestPrompt,
      status: 'PENDING',
      createdAt: '2026-07-27T14:00:00Z'
    }
  }));

  await page.goto('/codex-chatgpt-mkt');
  await page.getByRole('checkbox', { name: /Arquitetura/ }).check();
  await page.getByRole('checkbox', { name: /Lições Aprendidas/ }).check();
  await expect(page.getByText('Prompt', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Tela', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /Texto editável/ }).check();
  const promptTextarea = page.getByPlaceholder(/Digite sua solicitação de análise de marketing/);
  await expect(promptTextarea).toHaveValue('Texto inicial para editar antes de enviar.');
  await promptTextarea.fill('Texto inicial para editar antes de enviar.\n\nVerifique se os complementos entram no prompt.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();

  await expect.poll(() => createdRequestPrompt).toContain('Contexto prioritário selecionado pelo usuário. Use estes itens para interpretar e responder a próxima mensagem:');
  const priorityContext = createdRequestPrompt.slice(
    createdRequestPrompt.indexOf('Contexto prioritário selecionado pelo usuário'),
    createdRequestPrompt.indexOf('Última mensagem do usuário:')
  );
  expect(createdRequestPrompt).toContain('Manter o padrao de arquitetura definido.');
  expect(createdRequestPrompt).toContain('Use as licoes aprendidas dos experimentos finalizados.');
  expect(priorityContext).not.toContain('Texto inicial para editar antes de enviar.');
  expect(createdRequestPrompt).not.toContain('Leia e use como base o documento estrada.');
  expect(createdRequestPrompt).toContain('Última mensagem do usuário:\nTexto inicial para editar antes de enviar.\n\nVerifique se os complementos entram no prompt.');
  expect(createdRequestPrompt.indexOf('Contexto prioritário selecionado pelo usuário')).toBeLessThan(
    createdRequestPrompt.indexOf('Última mensagem do usuário:')
  );
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

test('marks a marketing comment as read and keeps the choice after reload', async ({ page }) => {
  await page.route('**/api/account/read', (route) => route.fulfill({
    json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
  }));
  await page.route('**/api/environments', (route) => route.fulfill({ json: [{ id: 1, name: 'produção' }] }));
  await page.route('**/api/account/models', (route) => route.fulfill({
    json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }]
  }));
  await page.route('**/api/codex/requests/metrics?**', (route) => route.fulfill({
    json: { day: { startsAt: '2026-07-26T00:00:00Z', requestCount: 3, interactionCount: 12, durationMs: 0 } }
  }));
  await page.route('**/api/codex/conversations?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/prompt-hints?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/codex/requests?**', (route) => route.fulfill({ json: { content: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT', JSON.stringify([
      {
        id: 'assistant-read-comment',
        role: 'assistant',
        content: JSON.stringify({ titulo: 'Análise pronta', comentario: 'Comentário que precisa ser acompanhado.', impactoAumentoVendas: 'medio', alterouCodigoRepositorio: false, resumoCodigoPr: '', sugestaoMelhoriaAmbiente: '' }),
        createdAt: '2026-07-26T12:00:00Z'
      }
    ]));
  });

  await page.goto('/codex-chatgpt-mkt');

  const operationalDayCard = page.getByText('Dia operacional').locator('xpath=ancestor::div[1]');
  await expect(operationalDayCard.getByText('Solicitações')).toBeVisible();
  await expect(operationalDayCard.getByText('Interações')).toBeVisible();
  await expect(operationalDayCard.getByText('3', { exact: true })).toBeVisible();
  await expect(operationalDayCard.getByText('12', { exact: true })).toBeVisible();
  await expect(operationalDayCard).toHaveCSS('position', 'fixed');

  const cardBoxBeforeScroll = await operationalDayCard.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { height: box.height, right: box.right, top: box.top };
  });
  expect(cardBoxBeforeScroll.height).toBeLessThanOrEqual(150);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const cardBoxAfterScroll = await operationalDayCard.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { right: box.right, top: box.top };
  });
  expect(Math.abs(cardBoxAfterScroll.top - cardBoxBeforeScroll.top)).toBeLessThan(1);
  expect(Math.abs(cardBoxAfterScroll.right - cardBoxBeforeScroll.right)).toBeLessThan(1);

  const commentCard = page.getByText('Comentário que precisa ser acompanhado.').locator('xpath=ancestor::section[1]');
  const readCheckbox = page.getByRole('checkbox', { name: 'Lido' });
  await expect(readCheckbox).not.toBeChecked();
  await expect(commentCard.locator('[title="Comentário pendente de leitura"]')).toBeVisible();
  await expect(commentCard).toHaveClass(/bg-amber-50/);
  await readCheckbox.check();
  await expect(readCheckbox).toBeChecked();
  await expect(commentCard.locator('[title="Comentário lido"]')).toBeVisible();
  await expect(commentCard).toHaveClass(/bg-emerald-50/);

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Lido' })).toBeChecked();
  await expect(page.getByText('Comentário que precisa ser acompanhado.').locator('xpath=ancestor::section[1]').locator('[title="Comentário lido"]')).toBeVisible();
});

test('dismisses a read marketing request from the dialog and restores it', async ({ page }) => {
  await page.route('**/api/account/read', (route) => route.fulfill({
    json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
  }));
  await page.route('**/api/environments', (route) => route.fulfill({ json: [{ id: 1, name: 'produção' }] }));
  await page.route('**/api/account/models', (route) => route.fulfill({
    json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }]
  }));
  await page.route('**/api/codex/requests/metrics?**', (route) => route.fulfill({
    json: { day: { startsAt: '2026-07-27T00:00:00Z', requestCount: 0, interactionCount: 0, durationMs: 0 } }
  }));
  await page.route('**/api/codex/conversations?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/prompt-hints?**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/codex/requests?**', (route) => route.fulfill({ json: { content: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT', JSON.stringify([
      {
        id: 'user-dismissable-request',
        role: 'user',
        content: 'Analise a campanha de remarketing já revisada.',
        createdAt: '2026-07-27T12:00:00Z'
      },
      {
        id: 'assistant-dismissable-request',
        role: 'assistant',
        requestId: 991,
        status: 'COMPLETED',
        content: JSON.stringify({ titulo: 'Remarketing revisado', comentario: 'Comentário lido que pode sair da tela.', impactoAumentoVendas: 'medio', alterouCodigoRepositorio: false, resumoCodigoPr: '', sugestaoMelhoriaAmbiente: '' }),
        createdAt: '2026-07-27T12:01:00Z'
      }
    ]));
  });

  await page.goto('/codex-chatgpt-mkt');

  await expect(page.getByText('Analise a campanha de remarketing já revisada.')).toBeVisible();
  await expect(page.getByText('Comentário lido que pode sair da tela.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retirar solicitação da tela' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Lido' }).check();
  await page.getByRole('button', { name: 'Retirar solicitação da tela' }).click();
  await expect(page.getByText('Analise a campanha de remarketing já revisada.')).toHaveCount(0);
  await expect(page.getByText('Comentário lido que pode sair da tela.')).toHaveCount(0);
  await expect(page.getByText('1 solicitação(ões) lida(s) retirada(s) da tela')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Analise a campanha de remarketing já revisada.')).toHaveCount(0);
  await expect(page.getByText('Comentário lido que pode sair da tela.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar novamente' }).click();
  await expect(page.getByText('Analise a campanha de remarketing já revisada.')).toBeVisible();
  await expect(page.getByText('Comentário lido que pode sair da tela.')).toBeVisible();
});

test('scrolls from the marketing prompt editor to the first unread model response', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/marketing-hub@main' }] });
  });
  await page.route('**/api/account/models', async (route) => {
    await route.fulfill({ json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }] });
  });
  await page.route('**/api/codex/requests/metrics?**', async (route) => {
    await route.fulfill({ json: { day: { startsAt: '2026-07-28T00:00:00Z', requestCount: 2, interactionCount: 2, durationMs: 1000 } } });
  });
  await page.route('**/api/codex/conversations?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/prompt-hints?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/products', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/codex/requests?**', async (route) => {
    await route.fulfill({ json: { content: [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('ai-hub:codex-chat-read-comments:CHATGPT_CODEX_MKT', JSON.stringify(['assistant-read']));
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT', JSON.stringify([
      {
        id: 'user-read',
        role: 'user',
        content: 'Analise a primeira campanha.',
        createdAt: '2026-07-28T11:00:00Z'
      },
      {
        id: 'assistant-read',
        role: 'assistant',
        requestId: 1001,
        status: 'COMPLETED',
        content: JSON.stringify({ titulo: 'Primeira leitura', comentario: 'Comentário já lido que deve ser pulado.', impactoAumentoVendas: 'medio', alterouCodigoRepositorio: false, resumoCodigoPr: '', sugestaoMelhoriaAmbiente: '' }),
        createdAt: '2026-07-28T11:01:00Z'
      },
      {
        id: 'user-unread',
        role: 'user',
        content: 'Analise a segunda campanha.',
        createdAt: '2026-07-28T11:02:00Z'
      },
      {
        id: 'assistant-unread',
        role: 'assistant',
        requestId: 1002,
        status: 'COMPLETED',
        content: JSON.stringify({ titulo: 'Resposta pendente', comentario: 'Comentário pendente alvo para leitura.', impactoAumentoVendas: 'alto', alterouCodigoRepositorio: false, resumoCodigoPr: '', sugestaoMelhoriaAmbiente: '' }),
        createdAt: '2026-07-28T11:03:00Z'
      }
    ]));
  });

  await page.goto('/codex-chatgpt-mkt');
  await page.locator('textarea[placeholder^="Digite sua solicitação"]').scrollIntoViewIfNeeded();

  const unreadButton = page.getByRole('button', { name: 'Ir para primeira resposta não lida' });
  await expect(unreadButton).toBeEnabled();
  await unreadButton.click();

  const unreadArticle = page.getByText('Comentário pendente alvo para leitura.').locator('xpath=ancestor::article[1]');
  await expect(unreadArticle).toBeFocused();
  await expect(page.getByText('Comentário já lido que deve ser pulado.').locator('xpath=ancestor::section[1]').locator('[title="Comentário lido"]')).toBeVisible();
});

test('disables the marketing prompt composer only when all 20 request positions are active', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/marketing-hub@main' }] });
  });
  await page.route('**/api/account/models', async (route) => {
    await route.fulfill({ json: [{ id: 'gpt-5', modelName: 'gpt-5', displayName: 'GPT-5' }] });
  });
  await page.route('**/api/codex/requests/metrics?**', async (route) => {
    await route.fulfill({ json: { day: { startsAt: '2026-07-28T00:00:00Z', requestCount: 20, interactionCount: 20, durationMs: 1000 } } });
  });
  await page.route('**/api/codex/conversations?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/prompt-hints?**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/products', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/codex/requests?**', async (route) => {
    await route.fulfill({ json: { content: [] } });
  });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('capacity-fixture-loaded')) return;
    window.sessionStorage.setItem('capacity-fixture-loaded', 'true');
    const conversation = Array.from({ length: 20 }, (_, index) => [{
      id: `user-active-${index}`,
      role: 'user',
      content: `Solicitação ativa ${index + 1}`,
      createdAt: '2026-07-28T13:00:00Z'
    }, {
      id: `assistant-active-${index}`,
      role: 'assistant',
      requestId: 2001 + index,
      status: index % 2 === 0 ? 'PENDING' : 'RUNNING',
      content: 'Aguardando resposta do modelo...',
      createdAt: '2026-07-28T13:01:00Z'
    }]).flat();
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT', JSON.stringify(conversation));
  });

  await page.goto('/codex-chatgpt-mkt');

  const capacityMessage = 'Aguarde: as 20 posições estão ocupadas por solicitações pendentes ou em processamento.';
  await expect(page.getByText(capacityMessage)).toBeVisible();
  await expect(page.locator(`textarea[placeholder="${capacityMessage}"]`)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();

  await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT') || '[]');
    stored[stored.length - 1].status = 'COMPLETED';
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT', JSON.stringify(stored));
    window.location.reload();
  });
  await expect(page.locator('textarea[placeholder^="Digite sua solicitação"]')).toBeEnabled();
});

test('marks a marketing request detail comment as read', async ({ page }) => {
  const responseText = JSON.stringify({
    titulo: 'Analise pronta',
    comentario: 'Comentário do detalhe que precisa ser acompanhado.',
    impactoAumentoVendas: 'medio',
    alterouCodigoRepositorio: false,
    resumoCodigoPr: '',
    sugestaoMelhoriaAmbiente: ''
  });
  await page.route('**/api/codex/requests/884/previous', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/codex/requests/884', (route) => route.fulfill({
    json: {
      id: 884,
      environment: 'paulofor/marketing-hub@main',
      model: 'gpt-5',
      version: 'aihub-6',
      profile: 'CHATGPT_CODEX_MKT',
      prompt: 'Analisar campanhas em Markdown',
      responseText,
      status: 'COMPLETED',
      createdAt: '2026-07-26T12:00:00Z',
      documentAccesses: []
    }
  }));

  await page.goto('/codex/requests/884');

  const commentCard = page.getByText('Comentário do detalhe que precisa ser acompanhado.').locator('xpath=ancestor::section[1]');
  const readCheckbox = page.getByRole('checkbox', { name: 'Lido' });
  await expect(readCheckbox).not.toBeChecked();
  await expect(commentCard.locator('[title="Comentário pendente de leitura"]')).toBeVisible();
  await expect(commentCard).toHaveClass(/bg-amber-50/);
  await readCheckbox.check();
  await expect(readCheckbox).toBeChecked();
  await expect(commentCard.locator('[title="Comentário lido"]')).toBeVisible();
  await expect(commentCard).toHaveClass(/bg-emerald-50/);

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Lido' })).toBeChecked();
  await expect(page.getByText('Comentário do detalhe que precisa ser acompanhado.').locator('xpath=ancestor::section[1]').locator('[title="Comentário lido"]')).toBeVisible();
});

test('shows a code generation icon on marketing comment cards with repository changes', async ({ page }) => {
  await page.route('**/api/account/read', async (route) => {
    await route.fulfill({
      json: { connected: true, status: 'connected', executable: true, authMode: 'chatgpt', planType: 'plus' }
    });
  });
  await page.route('**/api/environments', async (route) => {
    await route.fulfill({ json: [{ id: 1, name: 'paulofor/marketing-hub@main' }] });
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
  await page.route('**/api/products', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/codex/requests?**', async (route) => {
    await route.fulfill({ json: { content: [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('ai-hub:codex-chat-conversation:CHATGPT_CODEX_MKT', JSON.stringify([
      {
        id: 'assistant-code-generated',
        role: 'assistant',
        content: JSON.stringify({
          titulo: 'Aviso no comentário',
          comentario: 'Ajuste aplicado em `apps/frontend/src/pages/CodexChatgptPage.tsx`: o card de comentário agora mostra alerta visual quando há mudança no repositório.\n\nValidações executadas: `npm --prefix apps/frontend run build` passou.',
          impactoAumentoVendas: 'baixo',
          alterouCodigoRepositorio: true,
          resumoCodigoPr: 'Mostra alerta visual quando a resposta MKT declara alteração no repositório.',
          sugestaoMelhoriaAmbiente: ''
        }),
        createdAt: '2026-07-24T12:00:00Z'
      },
      {
        id: 'assistant-marketing-only',
        role: 'assistant',
        content: JSON.stringify({
          titulo: 'Análise de campanha',
          comentario: 'Recomendo testar uma promessa mais específica para o criativo de topo de funil e separar públicos frios de remarketing.',
          impactoAumentoVendas: 'alto',
          alterouCodigoRepositorio: false,
          resumoCodigoPr: '',
          sugestaoMelhoriaAmbiente: ''
        }),
        createdAt: '2026-07-24T12:01:00Z'
      },
      {
        id: 'assistant-marketing-medium',
        role: 'assistant',
        content: JSON.stringify({
          titulo: 'Instrumentação de métricas',
          comentario: 'Ajuste a leitura de métricas para separar leads qualificados de visitantes frios antes de mexer nos criativos.',
          impactoAumentoVendas: 'medio',
          alterouCodigoRepositorio: false,
          resumoCodigoPr: '',
          sugestaoMelhoriaAmbiente: ''
        }),
        createdAt: '2026-07-24T12:02:00Z'
      }
    ]));
  });

  await page.goto('/codex-chatgpt-mkt');

  const codeCommentCard = page.locator('section').filter({ hasText: 'Ajuste aplicado em' }).first();
  await expect(codeCommentCard.getByText('Gerou código')).toBeVisible();
  await expect(codeCommentCard.getByLabel('Impacto em vendas: baixo')).toBeVisible();
  await expect(page.getByText('Recomendo testar uma promessa')).toBeVisible();
  await expect(page.getByLabel('Impacto em vendas: alto')).toBeVisible();
  await expect(page.getByLabel('Impacto em vendas: médio')).toBeVisible();
  await expect(page.getByText('Gerou código')).toHaveCount(1);
});
