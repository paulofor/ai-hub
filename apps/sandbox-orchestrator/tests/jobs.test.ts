import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createApp } from '../src/server.js';
import { openAIClientConfigForTests, SandboxJobProcessor } from '../src/jobProcessor.js';
import { JobProcessor, SandboxJob } from '../src/types.js';

class StubProcessor implements JobProcessor {
  async process(job: SandboxJob): Promise<void> {
    job.timeoutCount = job.timeoutCount ?? 0;
    job.httpGetCount = job.httpGetCount ?? 0;
    job.dbQueryCount = job.dbQueryCount ?? 0;
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.status = 'COMPLETED';
    job.summary = 'ok';
    job.changedFiles = ['README.md'];
    job.finishedAt = new Date().toISOString();
    job.durationMs = 0;
    job.updatedAt = job.finishedAt;
  }
}

class SleepingProcessor implements JobProcessor {
  async process(job: SandboxJob): Promise<void> {
    job.timeoutCount = job.timeoutCount ?? 0;
    job.httpGetCount = job.httpGetCount ?? 0;
    job.dbQueryCount = job.dbQueryCount ?? 0;
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.status = 'RUNNING';
    job.updatedAt = job.startedAt;
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (job.cancelRequested) {
      job.status = 'CANCELLED';
      job.finishedAt = new Date().toISOString();
      job.durationMs = 0;
      job.updatedAt = job.finishedAt;
      return;
    }
    job.status = 'COMPLETED';
    job.finishedAt = new Date().toISOString();
    job.durationMs = 200;
    job.updatedAt = job.finishedAt;
  }
}

test('reports python availability on healthcheck', async () => {
  const app = createApp({ processor: new StubProcessor() });
  const response = await request(app).get('/health').expect(200);

  assert.equal(response.body.status, 'ok');
  assert.ok(response.body.python?.python, 'python path ausente no healthcheck');
});

test('docker compose monta e exporta credenciais AWS para o sandbox-orchestrator', async () => {
  const compose = await fs.readFile(path.resolve('../..', 'docker-compose.yml'), 'utf8');

  assert.match(compose, /\$\{AWS_CREDENTIALS_HOST_DIR:-\/root\/infra\/aws\}:\/run\/secrets\/aws:ro/);
  assert.match(compose, /\/run\/secrets\/aws\/acesso_aws/);
  assert.match(compose, /AWS_ACCESS_KEY_ID=/);
  assert.match(compose, /AWS_SECRET_ACCESS_KEY=/);
  assert.match(compose, /AWS_DEFAULT_REGION=/);
  assert.match(compose, /AWS_SESSION_TOKEN=/);
});

test('docker compose monta e exporta credenciais Luma e Kling para o sandbox-orchestrator', async () => {
  const compose = await fs.readFile(path.resolve('../..', 'docker-compose.yml'), 'utf8');

  assert.match(compose, /\$\{LUMA_TOKEN_HOST_DIR:-\/root\/infra\/luma-token\}:\/run\/secrets\/luma-token:ro/);
  assert.match(compose, /\$\{KLING_TOKEN_HOST_DIR:-\/root\/infra\/kling-token\}:\/run\/secrets\/kling-token:ro/);
  assert.match(compose, /\/run\/secrets\/luma-token\/luma_api_key/);
  assert.match(compose, /\/run\/secrets\/kling-token\/kling_api_key/);
  assert.match(compose, /export LUMA_API_KEY=\$\(cat \/run\/secrets\/luma-token\/luma_api_key\)/);
  assert.match(compose, /export KLING_API_KEY=\$\(cat \/run\/secrets\/kling-token\/kling_api_key\)/);
});

test('imagem da sandbox instala ferramentas de execução e validação do runner', async () => {
  const dockerfile = await fs.readFile(path.resolve('Dockerfile'), 'utf8');

  assert.match(dockerfile, /https:\/\/download\.docker\.com\/linux\/debian/);
  assert.match(dockerfile, /\bdocker-ce-cli\b/);
  assert.match(dockerfile, /\bdocker-compose-plugin\b/);
  assert.match(dockerfile, /\bgh\b/);
  assert.match(dockerfile, /\bffmpeg\b/);
  assert.match(dockerfile, /ACTIONLINT_VERSION=1\.7\.12/);
  assert.match(dockerfile, /PLAYWRIGHT_VERSION=1\.54\.2/);
  assert.match(dockerfile, /rhysd\/actionlint\/releases\/download\/v\$\{ACTIONLINT_VERSION\}/);
  assert.match(dockerfile, /actionlint --version/);
  assert.match(dockerfile, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g .*playwright@\$\{PLAYWRIGHT_VERSION\} .*@playwright\/test@\$\{PLAYWRIGHT_VERSION\}/);
  assert.match(dockerfile, /playwright --version/);
  assert.match(dockerfile, /NODE_PATH=\/usr\/local\/lib\/node_modules/);
  assert.doesNotMatch(dockerfile, /\bdocker\.io\b/);
});

test('accepts a job request and processes asynchronously', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-123',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'fix failing tests',
    testCommand: 'npm test',
  };

  const creation = await request(app).post('/jobs').send(payload).expect(201);
  assert.equal(creation.body.jobId, payload.jobId);
  assert.ok(['PENDING', 'RUNNING', 'COMPLETED'].includes(creation.body.status));

  // processor runs asynchronously and updates registry
  const stored = registry.get(payload.jobId);
  assert.ok(stored);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stored!.status, 'COMPLETED');
  assert.deepEqual(stored!.changedFiles, ['README.md']);
});

test('accepts non-image attachments in job request', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-file-attachment',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'analisar arquivo anexado',
    imageAttachments: [{
      name: 'briefing.pdf',
      mimeType: 'application/pdf',
      size: 7,
      dataUrl: 'data:application/pdf;base64,JVBERi0=',
    }],
  };

  await request(app).post('/jobs').send(payload).expect(201);

  const stored = registry.get(payload.jobId);
  assert.equal(stored?.imageAttachments?.[0]?.name, 'briefing.pdf');
  assert.equal(stored?.imageAttachments?.[0]?.mimeType, 'application/pdf');
  assert.equal(stored?.imageAttachments?.[0]?.dataUrl, 'data:application/pdf;base64,JVBERi0=');
});

test('accepts github token for PR creation without exposing it in job responses', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-github-token',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'fix failing tests',
    githubToken: 'secret-github-token',
  };

  const creation = await request(app).post('/jobs').send(payload).expect(201);
  assert.equal(creation.body.githubToken, undefined);

  const stored = registry.get(payload.jobId);
  assert.equal(stored?.githubToken, 'secret-github-token');

  const details = await request(app).get(`/jobs/${payload.jobId}`).expect(200);
  assert.equal(details.body.githubToken, undefined);
});

test('uses github token from job payload when creating a pull request', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-payload-token-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-payload-token-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-payload-token',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'updated with payload token' }),
              },
              { type: 'message', id: 'msg-pr-payload-token', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-payload-token-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'pr ready with payload token', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/9' }),
      text: async () => 'ok',
    } as any;
  };

  const originalPrToken = process.env.GITHUB_PR_TOKEN;
  const originalCloneToken = process.env.GITHUB_CLONE_TOKEN;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PR_TOKEN;
  delete process.env.GITHUB_CLONE_TOKEN;
  delete process.env.GITHUB_TOKEN;

  try {
    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
    const job: SandboxJob = {
      jobId: 'job-pr-payload-token',
      repoSlug: 'example/repo',
      repoUrl: bareRepo,
      branch: 'main',
      taskDescription: 'update readme',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
      githubToken: 'payload-token',
    } as SandboxJob;

    await processor.process(job);

    assert.equal(job.pullRequestUrl, 'https://github.com/example/repo/pull/9');
    assert.ok(fetchCalls.length > 0, 'fetch não foi chamado para criar PR');
    assert.equal(fetchCalls[0].init?.headers?.Authorization, 'Bearer payload-token');
    assert.ok(job.logs.some((entry) => entry.includes('payload.githubToken')), 'origem do token deve aparecer no log');
  } finally {
    if (originalPrToken === undefined) {
      delete process.env.GITHUB_PR_TOKEN;
    } else {
      process.env.GITHUB_PR_TOKEN = originalPrToken;
    }
    if (originalCloneToken === undefined) {
      delete process.env.GITHUB_CLONE_TOKEN;
    } else {
      process.env.GITHUB_CLONE_TOKEN = originalCloneToken;
    }
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
    await fs.rm(bareRepo, { recursive: true, force: true });
    await fs.rm(seedRepo, { recursive: true, force: true });
  }
});

test('returns existing job idempotently', async () => {
  const registry = new Map<string, SandboxJob>();
  const processor = new StubProcessor();
  const app = createApp({ jobRegistry: registry, processor });
  const payload = {
    jobId: 'job-abc',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'develop',
    taskDescription: 'refactor',
  };

  const first = await request(app).post('/jobs').send(payload).expect(201);
  const second = await request(app).post('/jobs').send(payload).expect(200);

  assert.equal(first.body.jobId, payload.jobId);
  assert.equal(second.body.jobId, payload.jobId);
});

test('não expõe o callbackSecret nas respostas', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-with-callback',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'callback test',
    callbackUrl: 'http://backend:8081/api/callback',
    callbackSecret: 'super-secret',
  };

  const creation = await request(app).post('/jobs').send(payload).expect(201);
  assert.equal(creation.body.jobId, payload.jobId);
  assert.equal(creation.body.callbackUrl, payload.callbackUrl);
  assert.ok(!('callbackSecret' in creation.body) || creation.body.callbackSecret === undefined, 'callbackSecret should not be exposed');

  const stored = registry.get(payload.jobId);
  assert.equal(stored?.callbackSecret, 'super-secret');
});


test('respostas de job usam maior contador de interações disponível quando interactionCount está defasado', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  registry.set('job-stale-interaction-count', {
    jobId: 'job-stale-interaction-count',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'count interactions',
    status: 'COMPLETED',
    interactions: [
      { id: 'job-stale-interaction-count-0001-outbound', direction: 'OUTBOUND', content: 'thread/start', createdAt: new Date().toISOString(), sequence: 1 },
      { id: 'job-stale-interaction-count-0002-outbound', direction: 'OUTBOUND', content: 'turn/start', createdAt: new Date().toISOString(), sequence: 2 },
    ],
    interactionSequence: 2,
    interactionCount: 0,
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  });

  const response = await request(app).get('/jobs/job-stale-interaction-count').expect(200);

  assert.equal(response.body.interactionCount, 2);
});

test('não persiste accessToken em jobs CHATGPT_CODEX', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-chatgpt-token',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'run with connected ChatGPT session',
    profile: 'CHATGPT_CODEX',
    accessToken: 'sess-token-123',
  };

  const creation = await request(app).post('/jobs').send(payload).expect(201);
  assert.equal(creation.body.jobId, payload.jobId);
  assert.equal(creation.body.profile, 'CHATGPT_CODEX');
  assert.ok(!('accessToken' in creation.body) || creation.body.accessToken === undefined, 'accessToken should not be exposed');

  const stored = registry.get(payload.jobId);
  assert.equal(stored?.accessToken, undefined);
});

test('não persiste accessToken em jobs CHATGPT_CODEX_MKT', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-chatgpt-mkt-token',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'analise relatorios md de marketing',
    profile: 'CHATGPT_CODEX_MKT',
    accessToken: 'sess-token-123',
  };

  const creation = await request(app).post('/jobs').send(payload).expect(201);
  assert.equal(creation.body.jobId, payload.jobId);
  assert.equal(creation.body.profile, 'CHATGPT_CODEX_MKT');

  const stored = registry.get(payload.jobId);
  assert.equal(stored?.accessToken, undefined);
});

test('aceita job CHATGPT_CODEX_SANDBOX sem repositório e sem branch', async () => {
  const registry = new Map<string, SandboxJob>();
  const app = createApp({ jobRegistry: registry, processor: new StubProcessor() });
  const payload = {
    jobId: 'job-chatgpt-codex-sandbox-api',
    taskDescription: 'execute uma tarefa temporária',
    profile: 'CHATGPT_CODEX_SANDBOX',
    githubToken: 'secret-github-token',
  };

  const creation = await request(app).post('/jobs').send(payload).expect(201);
  assert.equal(creation.body.profile, 'CHATGPT_CODEX_SANDBOX');
  assert.equal(creation.body.repoUrl, undefined);
  assert.equal(creation.body.githubToken, undefined);

  const stored = registry.get(payload.jobId);
  assert.ok(stored);
  assert.equal(stored!.repoUrl, undefined);
  assert.equal(stored!.branch, undefined);
  assert.equal(stored!.githubToken, undefined);
});

test('permite cancelar um job em execução', async () => {
  const registry = new Map<string, SandboxJob>();
  const processor = new SleepingProcessor();
  const app = createApp({ jobRegistry: registry, processor });
  const payload = {
    jobId: 'job-cancel-running',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'long running task',
  };

  await request(app).post('/jobs').send(payload).expect(201);
  const cancelResponse = await request(app).post(`/jobs/${payload.jobId}/cancel`).expect(200);

  assert.equal(cancelResponse.body.cancelRequested, true);
  assert.ok(['RUNNING', 'CANCELLED', 'PENDING'].includes(cancelResponse.body.status));

  await new Promise((resolve) => setTimeout(resolve, 250));
  const stored = registry.get(payload.jobId);
  assert.ok(stored, 'job não encontrado no registry após cancelamento');
  assert.equal(stored!.status, 'CANCELLED');
  assert.equal(stored!.cancelRequested, true);
  assert.ok(stored!.finishedAt, 'finishedAt deveria ser preenchido após cancelamento');
  assert.ok(typeof stored!.durationMs === 'number');
});

test('rejects invalid payload', async () => {
  const app = createApp({ processor: new StubProcessor() });
  await request(app).post('/jobs').send({}).expect(400);
});

test('returns 413 instead of 500 when job payload exceeds request body limit', async () => {
  const previous = process.env.SANDBOX_REQUEST_BODY_LIMIT;
  process.env.SANDBOX_REQUEST_BODY_LIMIT = '1kb';

  try {
    const app = createApp({ processor: new StubProcessor() });
    const response = await request(app)
      .post('/jobs')
      .send({
        jobId: 'job-too-large',
        repoUrl: 'https://github.com/example/repo.git',
        branch: 'main',
        taskDescription: 'x'.repeat(2048),
      })
      .expect(413);

    assert.equal(response.body.error, 'payload_too_large');
    assert.equal(response.body.limit, '1kb');
  } finally {
    if (previous === undefined) {
      delete process.env.SANDBOX_REQUEST_BODY_LIMIT;
    } else {
      process.env.SANDBOX_REQUEST_BODY_LIMIT = previous;
    }
  }
});

test('respects SANDBOX_WORKDIR when creating workspaces', async () => {
  const originalWorkdir = process.env.SANDBOX_WORKDIR;
  const customBase = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-custom-base-'));
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-custom-repo-'));

  try {
    process.env.SANDBOX_WORKDIR = customBase;

    execSync('git init', { cwd: tempRepo });
    execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
    execSync('git config user.name "CI Bot"', { cwd: tempRepo });
    await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
    execSync('git add README.md', { cwd: tempRepo });
    execSync('git commit -m "init"', { cwd: tempRepo });
    execSync('git branch -M main', { cwd: tempRepo });

    const fakeOpenAI = {
      responses: {
        create: async () => ({
          output: [
            {
              type: 'message',
              id: 'msg-workdir',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        }),
      },
    } as any;

    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
    const job: SandboxJob = {
      jobId: 'job-custom-workdir',
      repoUrl: tempRepo,
      branch: 'main',
      taskDescription: 'noop',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
    } as SandboxJob;

    await processor.process(job);

    assert.ok(job.sandboxPath?.startsWith(path.join(customBase, 'ai-hub-')));
    assert.ok(job.logs.some((entry) => entry.includes(customBase)));
  } finally {
    if (originalWorkdir === undefined) {
      delete process.env.SANDBOX_WORKDIR;
    } else {
      process.env.SANDBOX_WORKDIR = originalWorkdir;
    }
    await fs.rm(tempRepo, { recursive: true, force: true });
    await fs.rm(customBase, { recursive: true, force: true });
  }
});

test('limits oversized task descriptions before calling the model', async () => {
  const originalLimit = process.env.TASK_DESCRIPTION_MAX_CHARS;
  process.env.TASK_DESCRIPTION_MAX_CHARS = '50';

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-long-task-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        return {
          output: [
            {
              type: 'message',
              id: 'msg-truncated',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-long-task',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'x'.repeat(200),
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  const firstCall = fakeOpenAI.calls[0];
  const promptMessage = firstCall.input.find((msg: any) => msg.id === 'msg_objective' || msg.role === 'user');
  const text = promptMessage?.content?.find((item: any) => item.type === 'input_text')?.text ?? '';

  assert.ok(job.taskDescription.length <= 50, 'taskDescription should be truncated before sending to model');
  assert.ok(text.includes('truncated'), 'truncation hint should be present');
  assert.ok(job.logs.some((entry) => entry.includes('taskDescription com 200 caracteres')));

  if (originalLimit === undefined) {
    delete process.env.TASK_DESCRIPTION_MAX_CHARS;
  } else {
    process.env.TASK_DESCRIPTION_MAX_CHARS = originalLimit;
  }

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('configura prompt cache retention e chave estável na Responses API', async () => {
  const originalRetention = process.env.OPENAI_PROMPT_CACHE_RETENTION;
  const originalKeyPrefix = process.env.OPENAI_PROMPT_CACHE_KEY_PREFIX;
  process.env.OPENAI_PROMPT_CACHE_RETENTION = '24h';
  process.env.OPENAI_PROMPT_CACHE_KEY_PREFIX = 'acme';

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-prompt-cache-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  await fs.mkdir(path.join(tempRepo, 'src'), { recursive: true });
  await fs.writeFile(path.join(tempRepo, 'src', 'app.ts'), 'export const value = 1;');
  execSync('git add README.md src/app.ts', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        return {
          id: 'resp-cache-1',
          output: [
            {
              type: 'message',
              id: 'msg-cache',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  try {
    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
    const job: SandboxJob = {
      jobId: 'job-prompt-cache',
      repoUrl: tempRepo,
      repoSlug: 'ai-hub',
      branch: 'main',
      profile: 'STANDARD',
      taskDescription: 'noop',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
    } as SandboxJob;

    await processor.process(job);

    assert.equal(fakeOpenAI.calls.length, 1);
    assert.equal(fakeOpenAI.calls[0].prompt_cache_retention, '24h');
    assert.equal(fakeOpenAI.calls[0].prompt_cache_key, 'acme:ai-hub:main:STANDARD:gpt-5-codex');
  } finally {
    if (originalRetention === undefined) {
      delete process.env.OPENAI_PROMPT_CACHE_RETENTION;
    } else {
      process.env.OPENAI_PROMPT_CACHE_RETENTION = originalRetention;
    }
    if (originalKeyPrefix === undefined) {
      delete process.env.OPENAI_PROMPT_CACHE_KEY_PREFIX;
    } else {
      process.env.OPENAI_PROMPT_CACHE_KEY_PREFIX = originalKeyPrefix;
    }
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('executa CHATGPT_CODEX_MKT via Codex App Server com instruções de marketing', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-codex-app-server-mkt-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'relatorio.md'), '# Campanha\nresultado');
  execSync('git add relatorio.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const listeners = new Map<string, Array<(params: unknown) => void>>();
  const calls: Array<{ method: string; params?: unknown }> = [];
  const fakeCodexAppServerClient = {
    isReady: () => true,
    request: async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === 'account/read') return { authMode: 'chatgpt', planType: 'plus' };
      if (method === 'thread/start') return { id: 'thread-mkt' };
      if (method === 'turn/start') {
        setTimeout(() => {
          for (const listener of listeners.get('turn/completed') ?? []) listener({ status: 'completed', turnId: 'turn-mkt' });
        }, 5);
        return { id: 'turn-mkt' };
      }
      throw new Error(`unexpected method ${method}`);
    },
    onNotification: (method: string, listener: (params: unknown) => void) => {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
      return () => listeners.set(method, (listeners.get(method) ?? []).filter((item) => item !== listener));
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', undefined, globalThis.fetch, fakeCodexAppServerClient);
  const job: SandboxJob = {
    jobId: 'job-chatgpt-codex-mkt-app-server',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'avalie campanhas',
    profile: 'CHATGPT_CODEX_MKT',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);

    assert.equal(job.status, 'COMPLETED');
    const turnStartCall = calls.find((call) => call.method === 'turn/start');
    assert.ok(turnStartCall);
    const input = (turnStartCall.params as { input?: Array<{ text?: string }> }).input;
    assert.ok(input?.[0]?.text?.includes('Modo Codex ChatGPT MKT ativo'));
    assert.ok(input?.[0]?.text?.includes('arquivos Markdown'));
    assert.ok(input?.[0]?.text?.includes('melhor resposta possível'));
    assert.ok(input?.[0]?.text?.includes('Não criar Pull Request sem pedido explícito não significa evitar alterações'));
    assert.ok(input?.[0]?.text?.includes('altere os arquivos necessários'));
    assert.ok(input?.[0]?.text?.includes('apenas não abra nem publique o PR até o usuário pedir'));
    assert.ok(input?.[0]?.text?.includes('precisa passar por um Pull Request executado pelo usuário antes de ser publicada'));
    assert.ok(input?.[0]?.text?.includes('qualquer imagem usada em produção deve ser criada obrigatoriamente pelo código'));
    assert.ok(input?.[0]?.text?.includes('Dockerfile, Compose ou pipeline versionados neste repositório'));
    assert.ok(input?.[0]?.text?.includes('quando a solicitacao for criar um artefato dentro do Marketing Hub'));
    assert.ok(input?.[0]?.text?.includes('se o front-end ainda nao tiver a funcionalidade necessaria'));
    assert.ok(input?.[0]?.text?.includes('implemente essa funcionalidade, avise o usuario e aguarde o deploy'));
    assert.ok(input?.[0]?.text?.includes('quando a solicitacao for alterar uma funcionalidade de modulo'));
    assert.ok(input?.[0]?.text?.includes('Nunca use SSH para publicar diretamente uma alteracao'));
    assert.ok(input?.[0]?.text?.includes('Nosso objetivo principal é gerar vendas em larga escala'));
    assert.ok(input?.[0]?.text?.includes('sem encurtar a análise'));
    assert.ok(input?.[0]?.text?.includes('monte um ambiente local'));
    assert.ok(input?.[0]?.text?.includes('Você pode executar qualquer módulo do repositório no próprio ambiente para testar e ajustar a solução'));
    assert.ok(input?.[0]?.text?.includes('ajuste iterativamente até conseguir o funcionamento desejado'));
    assert.ok(input?.[0]?.text?.includes('possui Playwright e @playwright/test instalados'));
    assert.ok(input?.[0]?.text?.includes('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'));
    assert.ok(input?.[0]?.text?.includes('Use Playwright para validações visuais, screenshots e testes de UI'));
    assert.ok(input?.[0]?.text?.includes('O ffprobe está disponível para o modelo pelo comando ffprobe'));
    assert.ok(input?.[0]?.text?.includes('metadados, codecs, resolução, duração, streams'));
    assert.ok(input?.[0]?.text?.includes('pelo menos 3 alternativas boas'));
    assert.ok(input?.[0]?.text?.includes('compare benefícios, riscos, custo/esforço'));
    assert.ok(input?.[0]?.text?.includes('"titulo"'));
    assert.ok(input?.[0]?.text?.includes('O campo opcional "orientacaoProximaAcao"'));
    assert.ok(input?.[0]?.text?.includes('quando a solicitação já tiver sido implementada'));
    assert.ok(input?.[0]?.text?.includes('omita esse campo'));
    assert.ok(input?.[0]?.text?.includes('"sugestaoMelhoriaAmbiente"'));
    assert.ok(input?.[0]?.text?.includes('melhoria do ambiente de execução'));
    assert.ok(input?.[0]?.text?.includes('cliente de e-mail descartável'));
    assert.ok(input?.[0]?.text?.includes('sandbox-mail:1025'));
    assert.ok(input?.[0]?.text?.includes('http://sandbox-mail:8025/api/v1/messages'));
    assert.ok(input?.[0]?.text?.includes('avalie campanhas'));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('context manager organiza camadas e aplica GC quando o limite é atingido', async () => {
  const originalThreshold = process.env.CONTEXT_PROMPT_GC_TOKEN_THRESHOLD;
  const originalTarget = process.env.CONTEXT_PROMPT_GC_TARGET_TOKENS;
  process.env.CONTEXT_PROMPT_GC_TOKEN_THRESHOLD = '10';
  process.env.CONTEXT_PROMPT_GC_TARGET_TOKENS = '5';

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-context-gc-'));
  try {
    execSync('git init', { cwd: tempRepo });
    execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
    execSync('git config user.name "CI Bot"', { cwd: tempRepo });
    await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial content');
    execSync('git add README.md', { cwd: tempRepo });
    execSync('git commit -m "init"', { cwd: tempRepo });
    execSync('git branch -M main', { cwd: tempRepo });

    const fakeOpenAI = {
      calls: [] as any[],
      responses: {
        create: async (payload: any) => {
          fakeOpenAI.calls.push(payload);
          if (fakeOpenAI.calls.length === 1) {
            return {
              output: [
                {
                  type: 'function_call',
                  call_id: 'call-read',
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'README.md' }),
                },
                { type: 'message', id: 'msg-ctx', role: 'assistant', status: 'completed', content: [] },
              ],
            };
          }
          return {
            output: [
              {
                type: 'message',
                id: 'msg-final',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'feito', annotations: [] }],
              },
            ],
          };
        },
      },
    } as any;

    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
    const job: SandboxJob = {
      jobId: 'job-context-gc',
      repoUrl: tempRepo,
      branch: 'main',
      taskDescription: 'coletar arquivo',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
    } as SandboxJob;

    await processor.process(job);

    const secondCall = fakeOpenAI.calls[1];
    assert.ok(secondCall, 'segunda chamada não registrada');

    const objectiveMessage = secondCall.input.find((item: any) => item.id === 'msg_objective');
    assert.ok(objectiveMessage, 'camada de objetivo não enviada');

    const summaryMessage = secondCall.input.find((item: any) => item.id === 'msg_summary');
    assert.ok(summaryMessage, 'resumo rolante ausente');

    const workingSetMessage = secondCall.input.find((item: any) => item.id === 'msg_working_set');
    assert.ok(workingSetMessage, 'working set ausente');
    const workingText = workingSetMessage.content?.[0]?.text ?? '';
    assert.match(workingText, /Trecho de README\.md/, 'working set deveria registrar o arquivo lido');
    assert.match(workingText, /initial content/, 'conteúdo do arquivo deveria aparecer no working set');

    const toolOutputs = (secondCall.input as any[]).filter((item) => item.type === 'function_call_output');
    assert.equal(toolOutputs.length, 0, 'GC deveria remover outputs antigos quando o limite é atingido');
  } finally {
    if (originalThreshold === undefined) {
      delete process.env.CONTEXT_PROMPT_GC_TOKEN_THRESHOLD;
    } else {
      process.env.CONTEXT_PROMPT_GC_TOKEN_THRESHOLD = originalThreshold;
    }
    if (originalTarget === undefined) {
      delete process.env.CONTEXT_PROMPT_GC_TARGET_TOKENS;
    } else {
      process.env.CONTEXT_PROMPT_GC_TARGET_TOKENS = originalTarget;
    }
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});



test('compacta resumo técnico periodicamente e reutiliza evidência de tool equivalente', async () => {
  const originalCompactionInterval = process.env.CONTEXT_SUMMARY_COMPACTION_INTERVAL;
  process.env.CONTEXT_SUMMARY_COMPACTION_INTERVAL = '2';

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-context-compact-'));
  try {
    execSync('git init', { cwd: tempRepo });
    execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
    execSync('git config user.name "CI Bot"', { cwd: tempRepo });
    await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial content');
    execSync('git add README.md', { cwd: tempRepo });
    execSync('git commit -m "init"', { cwd: tempRepo });
    execSync('git branch -M main', { cwd: tempRepo });

    const fakeOpenAI = {
      calls: [] as any[],
      responses: {
        create: async (payload: any) => {
          fakeOpenAI.calls.push(payload);
          if (fakeOpenAI.calls.length === 1) {
            return {
              output: [
                {
                  type: 'function_call',
                  call_id: 'call-read-1',
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'README.md' }),
                },
                {
                  type: 'function_call',
                  call_id: 'call-shell-1',
                  name: 'run_shell',
                  arguments: JSON.stringify({ command: 'echo cache-check' }),
                },
                { type: 'message', id: 'msg-turn-1', role: 'assistant', status: 'completed', content: [] },
              ],
            };
          }
          if (fakeOpenAI.calls.length === 2) {
            return {
              output: [
                {
                  type: 'function_call',
                  call_id: 'call-read-2',
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'README.md' }),
                },
                { type: 'message', id: 'msg-turn-2', role: 'assistant', status: 'completed', content: [] },
              ],
            };
          }
          return {
            output: [
              {
                type: 'message',
                id: 'msg-final-compact',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'feito', annotations: [] }],
              },
            ],
          };
        },
      },
    } as any;

    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
    const job: SandboxJob = {
      jobId: 'job-context-compact',
      repoUrl: tempRepo,
      branch: 'main',
      taskDescription: 'testar compactação e cache',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
    } as SandboxJob;

    await processor.process(job);

    const secondCall = fakeOpenAI.calls[1];
    assert.ok(secondCall, 'segunda chamada não registrada');
    const summaryMessage = secondCall.input.find((item: any) => item.id === 'msg_summary');
    assert.ok(summaryMessage, 'resumo rolante ausente na segunda chamada');
    const summaryText = summaryMessage.content?.[0]?.text ?? '';
    assert.match(summaryText, /Resumo técnico compactado/, 'resumo técnico compactado deveria aparecer');

    assert.ok(
      job.logs.some((entry) => entry.includes('reutilizando evidência para read_file')),
      'deveria reutilizar evidência em chamada equivalente de read_file',
    );
    assert.ok(
      job.logs.some((entry) => entry.includes('KPI contexto: redução de chamadas redundantes=')),
      'deveria registrar KPI de contexto ao final do job',
    );
  } finally {
    if (originalCompactionInterval === undefined) {
      delete process.env.CONTEXT_SUMMARY_COMPACTION_INTERVAL;
    } else {
      process.env.CONTEXT_SUMMARY_COMPACTION_INTERVAL = originalCompactionInterval;
    }
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});
test('mantém itens de reasoning associados aos function_call no histórico recente', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-reasoning-'));
  try {
    execSync('git init', { cwd: tempRepo });
    execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
    execSync('git config user.name "CI Bot"', { cwd: tempRepo });
    await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial content');
    execSync('git add README.md', { cwd: tempRepo });
    execSync('git commit -m "init"', { cwd: tempRepo });
    execSync('git branch -M main', { cwd: tempRepo });

    const fakeOpenAI = {
      calls: [] as any[],
      responses: {
        create: async (payload: any) => {
          fakeOpenAI.calls.push(payload);
          if (fakeOpenAI.calls.length === 1) {
            return {
              output: [
                {
                  type: 'reasoning',
                  id: 'rs-1',
                  summary: [{ type: 'summary_text', text: 'planejando leitura' }],
                },
                {
                  type: 'function_call',
                  id: 'fc-1',
                  call_id: 'call-reason',
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'README.md' }),
                },
              ],
            };
          }
          return {
            output: [
              {
                type: 'message',
                id: 'msg-final-reason',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'ok', annotations: [] }],
              },
            ],
          };
        },
      },
    } as any;

    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
    const job: SandboxJob = {
      jobId: 'job-reasoning',
      repoUrl: tempRepo,
      branch: 'main',
      taskDescription: 'ler arquivo',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
    } as SandboxJob;

    await processor.process(job);

    const secondCall = fakeOpenAI.calls[1];
    assert.ok(secondCall, 'segunda chamada não registrada');
    const reasoningItem = (secondCall.input as any[]).find((item) => item.type === 'reasoning');
    assert.ok(reasoningItem, 'item de reasoning deveria ser reenviado junto com o histórico');
    const functionCall = (secondCall.input as any[]).find((item) => item.type === 'function_call');
    assert.ok(functionCall, 'function_call deveria permanecer no histórico recente');
    assert.equal(functionCall.call_id, 'call-reason');
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('returns job status', async () => {
  const registry = new Map<string, SandboxJob>();
  const processor = new StubProcessor();
  const app = createApp({ jobRegistry: registry, processor });
  registry.set('job-1', {
    jobId: 'job-1',
    repoUrl: 'https://example',
    branch: 'main',
    taskDescription: 'noop',
    status: 'COMPLETED',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
    changedFiles: [],
  });

  const response = await request(app).get('/jobs/job-1').expect(200);
  assert.equal(response.body.jobId, 'job-1');
});

test('returns orphaned workspace when registry is empty', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-orphans-'));
  const originalWorkdir = process.env.SANDBOX_WORKDIR;
  process.env.SANDBOX_WORKDIR = tempDir;

  const sandboxPath = await fs.mkdtemp(path.join(tempDir, 'ai-hub-job-orphan-'));

  try {
    const registry = new Map<string, SandboxJob>();
    const processor = new StubProcessor();
    const app = createApp({ jobRegistry: registry, processor });

    const response = await request(app).get('/jobs/job-orphan').expect(200);
    assert.equal(response.body.jobId, 'job-orphan');
    assert.equal(response.body.status, 'FAILED');
    assert.equal(response.body.sandboxPath, sandboxPath);
    assert.match(response.body.error, /workspace preservado/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    process.env.SANDBOX_WORKDIR = originalWorkdir;
  }
});

test('processes tool calls inside a sandbox', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-job-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'updated content' }),
              },
              { type: 'message', id: 'msg-1', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'summary ready', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-tools',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'update file',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  const firstCall = fakeOpenAI.calls[0];
  assert.ok(firstCall.tools, 'tools ausente na chamada inicial');
  assert.deepEqual(
    firstCall.tools.map((tool: any) => tool.name ?? tool.function?.name).filter(Boolean),
    ['run_shell', 'read_file', 'read_image', 'fetch_image', 'write_file', 'http_get', 'WebSearch', 'db_query']
  );

  assert.equal(job.status, 'COMPLETED', job.error);
  assert.equal(job.summary, 'summary ready');
  assert.ok(job.patch && job.patch.includes('updated content'));
  assert.ok(job.logs.some((entry) => entry.includes('write_file')));

  const secondCall = fakeOpenAI.calls[1];
  const functionCall = secondCall.input.find((msg: any) => msg.type === 'function_call');
  assert.equal(functionCall?.id, 'call-1');
  assert.equal(functionCall?.call_id, 'call-1');

  const toolMessage = secondCall.input.find((msg: any) => msg.type === 'function_call_output');
  assert.ok(toolMessage?.id.startsWith('fco_'), 'function_call_output id sem prefixo fco_');
  assert.equal(toolMessage?.call_id, 'call-1');
  const parsedTool = JSON.parse(toolMessage.output);
  assert.equal(parsedTool.path, 'README.md');
  assert.equal(parsedTool.content, 'updated content');

  await fs.rm(tempRepo, { recursive: true, force: true });
});


test('read_image reenvia imagem local como input_image multimodal', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-read-image-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  await fs.mkdir(path.join(tempRepo, 'screenshots'), { recursive: true });
  await fs.writeFile(
    path.join(tempRepo, 'screenshots', 'pixel.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  );
  execSync('git add README.md screenshots/pixel.png', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-read-image',
                name: 'read_image',
                arguments: JSON.stringify({ path: 'screenshots/pixel.png' }),
              },
              { type: 'message', id: 'msg-read-image', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-read-image-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'imagem analisada', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-read-image',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'analise screenshot local',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    const secondCall = fakeOpenAI.calls[1];
    const imageMessage = secondCall.input.find((item: any) => item.type === 'message' && item.role === 'user'
      && item.content?.some((content: any) => content.type === 'input_image'));
    assert.ok(imageMessage, 'imagem local não foi reenviada como input_image');
    const imageContent = imageMessage.content.find((content: any) => content.type === 'input_image');
    assert.match(imageContent.image_url, /^data:image\/png;base64,/);
    assert.equal(imageContent.detail, 'high');
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});


test('bloqueia LOCALIZAR_CAUSA após N ciclos sem nova evidência', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-stagnation-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'same content');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const originalAttempts = process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS;
  process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS = '3';

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length <= 4) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: `call-stall-${fakeOpenAI.calls.length}`,
                name: 'read_file',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
              { type: 'message', id: `msg-stall-${fakeOpenAI.calls.length}`, role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-stall-final',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'diagnóstico parcial', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-stagnation',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'investigue e corrija',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.ok(job.logs.some((entry) => entry.includes('bloqueio por falta de nova evidência')));

    const fifthCall = fakeOpenAI.calls[4];
    const blockedOutput = fifthCall.input
      .filter((item: any) => item.type === 'function_call_output')
      .map((item: any) => {
        try {
          return JSON.parse(item.output);
        } catch (_err) {
          return {};
        }
      })
      .find((payload: any) => payload?.error === 'LOCALIZAR_CAUSA sem nova evidência.');
    assert.ok(blockedOutput, 'esperava function_call_output com bloqueio');
    assert.match(String(blockedOutput.requiredAction), /nova hipótese|diagnóstico/i);
  } finally {
    if (originalAttempts === undefined) {
      delete process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS;
    } else {
      process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS = originalAttempts;
    }
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('truncates tool outputs before sending them back to the model', async () => {
  const originalStringLimit = process.env.TOOL_OUTPUT_STRING_LIMIT;
  const originalSerializedLimit = process.env.TOOL_OUTPUT_SERIALIZED_LIMIT;
  process.env.TOOL_OUTPUT_STRING_LIMIT = '80';
  process.env.TOOL_OUTPUT_SERIALIZED_LIMIT = '120';

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-tool-output-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'y'.repeat(300));
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-read-long',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
              { type: 'message', id: 'msg-read-long', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-read-long-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-tool-truncation',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'read long file',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  const secondCall = fakeOpenAI.calls[1];
  const toolMessage = secondCall.input.find((msg: any) => msg.type === 'function_call_output');
  assert.ok(toolMessage, 'mensagem de tool ausente');

  const output = toolMessage?.output ?? '';
  assert.ok(output.length <= 120, 'tool output must respect serialized limit');

  const parsed = JSON.parse(output);
  assert.ok(parsed.content.includes('truncated'), 'conteúdo deve indicar truncamento');
  assert.ok(parsed.content.length <= 80, 'tool output string deve respeitar limite configurado');
  assert.ok(job.logs.some((entry) => entry.includes('output de tool truncado')));

  if (originalStringLimit === undefined) {
    delete process.env.TOOL_OUTPUT_STRING_LIMIT;
  } else {
    process.env.TOOL_OUTPUT_STRING_LIMIT = originalStringLimit;
  }

  if (originalSerializedLimit === undefined) {
    delete process.env.TOOL_OUTPUT_SERIALIZED_LIMIT;
  } else {
    process.env.TOOL_OUTPUT_SERIALIZED_LIMIT = originalSerializedLimit;
  }

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('collects patch and changed files even when the model commits changes', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-job-commit-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        const turn = fakeOpenAI.calls.length;
        if (turn === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'write-file',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'committed change' }),
              },
              { type: 'message', id: 'msg-1', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        if (turn === 2) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'add',
                name: 'run_shell',
                arguments: JSON.stringify({ command: ['git', 'add', 'README.md'], cwd: '.' }),
              },
              { type: 'message', id: 'msg-2', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        if (turn === 3) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'commit',
                name: 'run_shell',
                arguments: JSON.stringify({ command: ['git', 'commit', '-m', 'model-commit'], cwd: '.' }),
              },
              { type: 'message', id: 'msg-3', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-4',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'committed summary', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-commit',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'commit flow',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  assert.equal(job.status, 'COMPLETED', job.error);
  assert.equal(job.summary, 'committed summary');
  assert.ok(job.patch && job.patch.includes('committed change'), 'patch vazio após commit do modelo');
  assert.deepEqual(job.changedFiles, ['README.md']);

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('normalizes read_file path to repo-relative when sending tool outputs', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-read-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-read-1',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
              {
                type: 'function_call',
                call_id: 'call-read-source',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'src/app.ts' }),
              },
              { type: 'message', id: 'msg-read', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-read-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-read-path',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'read a file',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  const secondCall = fakeOpenAI.calls[1];
  const toolMessage = secondCall.input.find((msg: any) => msg.type === 'function_call_output');
  assert.ok(toolMessage, 'mensagem da ferramenta ausente');
  const parsedOutput = JSON.parse(toolMessage.output);
  assert.equal(parsedOutput.path, 'README.md');
  assert.equal(parsedOutput.content, 'initial');
  assert.deepEqual(
    job.documentAccesses?.map((entry) => entry.documentPath),
    ['README.md'],
  );

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('returns tool errors to the model instead of failing the job', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-error-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-error-1',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'package.json' }),
              },
              { type: 'message', id: 'msg-err', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        const toolMessage = payload.input.find((msg: any) => msg.type === 'function_call_output');
        const parsed = toolMessage ? JSON.parse(toolMessage.output) : {};
        return {
          output: [
            {
              type: 'message',
              id: 'msg-err-2',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: parsed.error ? 'handled missing file' : 'no error',
                  annotations: [],
                },
              ],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-error',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'read a missing file',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  const secondCall = fakeOpenAI.calls[1];
  const toolMessage = secondCall.input.find((msg: any) => msg.type === 'function_call_output');
  assert.ok(toolMessage, 'mensagem de ferramenta ausente');
  const parsedOutput = JSON.parse(toolMessage.output);
  assert.ok(parsedOutput.error, 'tool error deve ser retornado ao modelo');
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, 'handled missing file');

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('http_get fetches public content while sanitizing headers and truncating body', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-http-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'http-call',
                name: 'http_get',
                arguments: JSON.stringify({ url: 'https://example.com/docs', headers: { Authorization: 'x', Accept: 'text/plain' } }),
              },
              { type: 'message', id: 'msg-http-1', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-http-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'http ok', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    fetchCalls.push({ input, init });
    return {
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'conteúdo público'.repeat(5),
    } as any;
  };

  const originalLimit = process.env.HTTP_TOOL_MAX_RESPONSE_CHARS;
  process.env.HTTP_TOOL_MAX_RESPONSE_CHARS = '20';

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-http',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'fetch docs',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);
  assert.equal(job.httpGetCount, 1, 'http_get deve ser contabilizado');
  assert.equal(job.httpGetSuccessCount, 1, 'http_get bem-sucedido deve ser contado');
  assert.ok(job.httpRequests, 'httpRequests deve ser preenchido');
  assert.equal(job.httpRequests?.length, 1, 'deve registrar a chamada http_get');
  const httpLog = job.httpRequests?.[0];
  assert.ok(httpLog, 'log http_get ausente');
  assert.equal(httpLog?.toolName, 'http_get');
  assert.equal(httpLog?.status, 200);
  assert.equal(httpLog?.success, true);
  assert.ok(httpLog?.requestedAt, 'requestedAt deve ser informado');
  assert.ok(httpLog?.url.includes('example.com/docs'));

  const callOutput = fakeOpenAI.calls[1].input.find((msg: any) => msg.type === 'function_call_output');
  const parsed = JSON.parse(callOutput.output);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers['content-type'], 'text/plain');
  assert.ok(parsed.truncated, 'body deve estar truncado');
  assert.ok(parsed.body.includes('truncated'), 'resposta deve indicar truncamento do corpo');
  assert.equal(job.summary, 'http ok');
  assert.equal(fetchCalls[0].init?.method, 'GET');
  assert.ok(!('authorization' in fetchCalls[0].init.headers));

  if (originalLimit === undefined) {
    delete process.env.HTTP_TOOL_MAX_RESPONSE_CHARS;
  } else {
    process.env.HTTP_TOOL_MAX_RESPONSE_CHARS = originalLimit;
  }

  await fs.rm(tempRepo, { recursive: true, force: true });
});


test('WebSearch atua como alias de http_get contabilizando sucessos', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-websearch-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'search-1',
                name: 'WebSearch',
                arguments: JSON.stringify({ url: 'https://example.com/search?q=test' }),
              },
              { type: 'message', id: 'msg-web-1', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-web-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'search ok', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    fetchCalls.push({ input, init });
    return {
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html>ok</html>',
      ok: true,
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-websearch',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'search web',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);
  assert.equal(job.httpGetCount, 1, 'WebSearch deve incrementar httpGetCount');
  assert.equal(job.httpGetSuccessCount, 1, 'WebSearch bem-sucedido deve incrementar sucesso');
  assert.equal(job.httpRequests?.length, 1, 'WebSearch deve registrar log');
  const httpLog = job.httpRequests?.[0];
  assert.equal(httpLog?.toolName, 'WebSearch');
  assert.equal(httpLog?.success, true);
  assert.equal(httpLog?.status, 200);
  assert.ok((httpLog?.url ?? '').includes('example.com/search'));

  const callOutput = fakeOpenAI.calls[1].input.find((msg: any) => msg.type === 'function_call_output');
  const parsed = JSON.parse(callOutput.output);
  assert.equal(parsed.status, 200);
  assert.equal(job.summary, 'search ok');
  assert.equal(fetchCalls[0].init?.method, 'GET');
  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('http_get blocks private addresses and returns an error to the model', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-http-block-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'http-block',
                name: 'http_get',
                arguments: JSON.stringify({ url: 'http://127.0.0.1:8083' }),
              },
              { type: 'message', id: 'msg-http-block-1', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        const toolMessage = payload.input.find((msg: any) => msg.type === 'function_call_output');
        const parsed = toolMessage ? JSON.parse(toolMessage.output) : {};
        return {
          output: [
            {
              type: 'message',
              id: 'msg-http-block-2',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: parsed.error ? 'http error propagated' : 'no error',
                  annotations: [],
                },
              ],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-http-block',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'fetch forbidden',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);
  assert.equal(job.httpGetCount, 1, 'http_get inválido também deve contar');
  assert.equal(job.httpGetSuccessCount ?? 0, 0, 'chamadas bloqueadas não devem contar como sucesso');
  assert.equal(job.httpRequests?.length ?? 0, 0, 'chamadas bloqueadas não devem ser registradas');

  const toolMessage = fakeOpenAI.calls[1].input.find((msg: any) => msg.type === 'function_call_output');
  const parsed = JSON.parse(toolMessage.output);
  assert.ok(parsed.error?.includes('bloqueado') || parsed.error?.includes('permitidas'));
  assert.equal(job.summary, 'http error propagated');
  assert.equal(job.status, 'COMPLETED');

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('propagates tool errors for a single call id', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-dir-error-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-dir-error',
                name: 'read_file',
                arguments: JSON.stringify({ path: '.' }),
              },
              { type: 'message', id: 'msg-dir', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        const outputs = payload.input.filter((msg: any) => msg.type === 'function_call_output');
        return {
          output: [
            {
              type: 'message',
              id: 'msg-dir-2',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: outputs.length > 0 ? 'errors returned' : 'missing outputs',
                  annotations: [],
                },
              ],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-dir-error',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'try to read directory',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  const secondCall = fakeOpenAI.calls[1];
  const outputs = secondCall.input.filter((msg: any) => msg.type === 'function_call_output');

  assert.equal(outputs.length, 1, 'apenas um call_id deve receber output');
  const parsed = JSON.parse(outputs[0].output);
  assert.equal(outputs[0].call_id, 'call-dir-error');
  assert.ok(parsed.error, 'erro da ferramenta deve ser propagado');
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, 'errors returned');

  await fs.rm(tempRepo, { recursive: true, force: true });
});

test('pushes changes and opens a pull request when credentials are present', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'updated for pr' }),
              },
              { type: 'message', id: 'msg-pr', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'pr ready', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/1' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-pr',
    repoSlug: 'example/repo',
    repoUrl: bareRepo,
    branch: 'main',
    workBranch: 'ai-hub/codex-example-repo-main-chatgpt',
    taskDescription: 'update readme',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  const originalToken = process.env.GITHUB_PR_TOKEN;
  process.env.GITHUB_PR_TOKEN = 'fake-token';

  await processor.process(job);

  const heads = execSync(`git ls-remote ${bareRepo} refs/heads/${job.workBranch}`);
  assert.ok(heads.toString().includes(job.workBranch ?? ''));
  assert.equal(job.pullRequestUrl, 'https://github.com/example/repo/pull/1');
  assert.ok(fetchCalls.length > 0, 'fetch não foi chamado para criar PR');
  assert.ok(
    fetchCalls[0].url.endsWith('/repos/example/repo/pulls'),
    'PR deve ser criado no endpoint de pulls do repositório',
  );

  process.env.GITHUB_PR_TOKEN = originalToken;
  await fs.rm(bareRepo, { recursive: true, force: true });
  await fs.rm(seedRepo, { recursive: true, force: true });
});

test('pushes work branch without opening pull request when disabled by job', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-disabled-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-disabled-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-disabled-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'updated without pr' }),
              },
              { type: 'message', id: 'msg-pr-disabled', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-disabled-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'branch ready', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/99' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-pr-disabled',
    repoSlug: 'example/repo',
    repoUrl: bareRepo,
    branch: 'main',
    workBranch: 'ai-hub/codex-example-repo-main-chatgpt-disabled',
    taskDescription: 'update readme without pr',
    createPullRequest: false,
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  const originalToken = process.env.GITHUB_PR_TOKEN;
  process.env.GITHUB_PR_TOKEN = 'fake-token';

  try {
    await processor.process(job);

    const heads = execSync(`git ls-remote ${bareRepo} refs/heads/${job.workBranch}`);
    assert.ok(heads.toString().includes(job.workBranch ?? ''));
    assert.equal(job.pullRequestUrl, undefined);
    assert.equal(fetchCalls.length, 0, 'fetch não deve ser chamado para criar PR');
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_PR_TOKEN;
    } else {
      process.env.GITHUB_PR_TOKEN = originalToken;
    }
    await fs.rm(bareRepo, { recursive: true, force: true });
    await fs.rm(seedRepo, { recursive: true, force: true });
  }
});


test('creates a pull request when only new files are added', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-new-files-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-new-files-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-new-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'docs/new-feature.md', content: 'new docs content' }),
              },
              { type: 'message', id: 'msg-pr-new', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-new-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'docs added', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/4' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-pr-new-files',
    repoSlug: 'example/repo',
    repoUrl: bareRepo,
    branch: 'main',
    taskDescription: 'add docs',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  const originalToken = process.env.GITHUB_PR_TOKEN;
  process.env.GITHUB_PR_TOKEN = 'fake-token';

  await processor.process(job);

  const heads = execSync(`git ls-remote ${bareRepo} refs/heads/ai-hub/cifix-${job.jobId}`);
  assert.ok(heads.toString().includes(`ai-hub/cifix-${job.jobId}`));
  assert.equal(job.pullRequestUrl, 'https://github.com/example/repo/pull/4');
  assert.ok(fetchCalls.length > 0, 'fetch não foi chamado para criar PR');
  assert.ok(job.changedFiles?.includes('docs/new-feature.md'));

  if (originalToken === undefined) {
    delete process.env.GITHUB_PR_TOKEN;
  } else {
    process.env.GITHUB_PR_TOKEN = originalToken;
  }

  await fs.rm(bareRepo, { recursive: true, force: true });
  await fs.rm(seedRepo, { recursive: true, force: true });
});


test('loads existing work branch before model execution and diffs against base branch', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-existing-work-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-existing-work-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'base');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });
  execSync('git checkout -B ai-hub/codex-example-repo-main-chatgpt', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'change from previous request');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "previous request"', { cwd: seedRepo });
  execSync('git push origin ai-hub/codex-example-repo-main-chatgpt', { cwd: seedRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-read-existing-work',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
              { type: 'message', id: 'msg-existing-work', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-existing-work-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'existing branch inspected', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async () => {
    fetchCalls.push({});
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/5' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-existing-work',
    repoSlug: 'example/repo',
    repoUrl: bareRepo,
    branch: 'main',
    workBranch: 'ai-hub/codex-example-repo-main-chatgpt',
    taskDescription: 'open pr for previous changes',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  const originalToken = process.env.GITHUB_PR_TOKEN;
  process.env.GITHUB_PR_TOKEN = 'fake-token';

  await processor.process(job);

  const interactionText = JSON.stringify(job.interactions);
  assert.ok(interactionText.includes('change from previous request'), 'modelo deve enxergar conteúdo da workBranch existente');
  assert.ok(job.patch?.includes('change from previous request'), 'patch deve comparar workBranch contra a base main');
  assert.equal(job.pullRequestUrl, 'https://github.com/example/repo/pull/5');
  assert.ok(fetchCalls.length > 0, 'PR deve ser criado para mudanças acumuladas na workBranch');

  if (originalToken === undefined) {
    delete process.env.GITHUB_PR_TOKEN;
  } else {
    process.env.GITHUB_PR_TOKEN = originalToken;
  }
  await fs.rm(bareRepo, { recursive: true, force: true });
  await fs.rm(seedRepo, { recursive: true, force: true });
});

test('limits pull request title and keeps full summary in body', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-long-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-long-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const longSummary = 'a'.repeat(300);
  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-long-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'updated for pr' }),
              },
              { type: 'message', id: 'msg-pr-long', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-long-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: longSummary, annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/3' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-pr-long',
    repoSlug: 'example/repo',
    repoUrl: bareRepo,
    branch: 'main',
    taskDescription: 'update readme',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  const originalToken = process.env.GITHUB_PR_TOKEN;
  process.env.GITHUB_PR_TOKEN = 'fake-token';

  await processor.process(job);

  const payload = JSON.parse(fetchCalls[0].init.body);
  assert.ok(payload.title.length <= 256, 'título do PR deve respeitar o limite do GitHub');
  assert.equal(payload.title, `AI Hub: ${longSummary.slice(0, 247)}…`);
  assert.ok(
    payload.body.includes(longSummary),
    'corpo do PR deve conter o resumo completo, sem truncar',
  );
  assert.ok(payload.body.includes('Descrição da tarefa'), 'corpo do PR deve incluir a tarefa');

  process.env.GITHUB_PR_TOKEN = originalToken;
  await fs.rm(bareRepo, { recursive: true, force: true });
  await fs.rm(seedRepo, { recursive: true, force: true });
});

test('reuses repository credentials from repoUrl when creating a pull request', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-url-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-url-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const repoUrl = bareRepo;

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-url-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'updated via url token' }),
              },
              { type: 'message', id: 'msg-pr-url', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-url-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'pr ready from url token', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/2' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const originalClone = (processor as any).cloneRepository?.bind(processor);
  (processor as any).cloneRepository = async (...args: any[]) => {
    if (originalClone) {
      await originalClone(...args);
    }
    delete process.env.GITHUB_CLONE_TOKEN;
    delete process.env.GITHUB_TOKEN;
  };
  const job: SandboxJob = {
    jobId: 'job-pr-url',
    repoSlug: 'example/repo',
    repoUrl,
    branch: 'main',
    taskDescription: 'update readme',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  timeoutCount: 0,
  } as SandboxJob;

  const originalPrToken = process.env.GITHUB_PR_TOKEN;
  const originalCloneToken = process.env.GITHUB_CLONE_TOKEN;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PR_TOKEN;
  process.env.GITHUB_CLONE_TOKEN = 'embedded-token';
  delete process.env.GITHUB_TOKEN;

  await processor.process(job);

  const pushedBranch = execSync(`git ls-remote ${bareRepo} refs/heads/ai-hub/cifix-${job.jobId}`);
  assert.ok(pushedBranch.toString().includes(`ai-hub/cifix-${job.jobId}`));
  assert.equal(job.pullRequestUrl, 'https://github.com/example/repo/pull/2');
  assert.ok(fetchCalls.length > 0, 'fetch não foi chamado para criar PR');
  assert.ok(
    fetchCalls[0].init?.headers?.Authorization.includes('embedded-token'),
    'token do repoUrl deve ser reutilizado ao criar PR',
  );

  if (originalPrToken === undefined) {
    delete process.env.GITHUB_PR_TOKEN;
  } else {
    process.env.GITHUB_PR_TOKEN = originalPrToken;
  }
  if (originalCloneToken === undefined) {
    delete process.env.GITHUB_CLONE_TOKEN;
  } else {
    process.env.GITHUB_CLONE_TOKEN = originalCloneToken;
  }
  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken;
  }

  await fs.rm(bareRepo, { recursive: true, force: true });
  await fs.rm(seedRepo, { recursive: true, force: true });
});




test('retries pull request creation after transient errors', async () => {
  const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-retry-remote-'));
  execSync('git init --bare', { cwd: bareRepo });

  const seedRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-pr-retry-seed-'));
  execSync('git init', { cwd: seedRepo });
  execSync('git config user.email "ci@example.com"', { cwd: seedRepo });
  execSync('git config user.name "CI Bot"', { cwd: seedRepo });
  await fs.writeFile(path.join(seedRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: seedRepo });
  execSync('git commit -m "init"', { cwd: seedRepo });
  execSync('git branch -M main', { cwd: seedRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: seedRepo });
  execSync('git push origin main', { cwd: seedRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-pr-retry-1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'retry content' }),
              },
              { type: 'message', id: 'msg-pr-retry', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-pr-retry-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'retry summary', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const fetchCalls: any[] = [];
  const fakeFetch = async (input: string | URL, init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    const attempt = fetchCalls.length + 1;
    fetchCalls.push({ attempt, url, init });
    if (attempt === 1) {
      const error: any = new Error('fetch failed');
      error.code = 'ECONNRESET';
      throw error;
    }
    if (attempt === 2) {
      return {
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      } as any;
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/example/repo/pull/7' }),
      text: async () => 'ok',
    } as any;
  };

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI, fakeFetch);
  const job: SandboxJob = {
    jobId: 'job-pr-retry',
    repoSlug: 'example/repo',
    repoUrl: bareRepo,
    branch: 'main',
    taskDescription: 'retry pr creation',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  const originalToken = process.env.GITHUB_PR_TOKEN;
  const originalAttempts = process.env.PR_CREATE_RETRY_ATTEMPTS;
  const originalDelay = process.env.PR_CREATE_RETRY_DELAY_MS;
  process.env.GITHUB_PR_TOKEN = 'fake-token';
  process.env.PR_CREATE_RETRY_ATTEMPTS = '3';
  process.env.PR_CREATE_RETRY_DELAY_MS = '1';

  try {
    await processor.process(job);
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_PR_TOKEN;
    } else {
      process.env.GITHUB_PR_TOKEN = originalToken;
    }
    if (originalAttempts === undefined) {
      delete process.env.PR_CREATE_RETRY_ATTEMPTS;
    } else {
      process.env.PR_CREATE_RETRY_ATTEMPTS = originalAttempts;
    }
    if (originalDelay === undefined) {
      delete process.env.PR_CREATE_RETRY_DELAY_MS;
    } else {
      process.env.PR_CREATE_RETRY_DELAY_MS = originalDelay;
    }
  }

  assert.equal(job.pullRequestUrl, 'https://github.com/example/repo/pull/7');
  assert.equal(fetchCalls.length, 3);
  assert.ok(
    job.logs.some((entry) => entry.includes('tentativa 1/3 falhou ao chamar API do GitHub')),
    'deve registrar o retry após erro de rede',
  );
  assert.ok(
    job.logs.some((entry) => entry.includes('tentativa 2/3 ao criar PR retornou status 502')),
    'deve registrar o retry após status HTTP 5xx',
  );

  await fs.rm(bareRepo, { recursive: true, force: true });
  await fs.rm(seedRepo, { recursive: true, force: true });
});


test('inclui checklist de ambiente OK no prompt inicial do runner', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-preflight-checklist-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        return {
          output: [
            {
              type: 'message',
              id: 'msg-checklist',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'ok', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-preflight-checklist',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'noop',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    const firstSystem = fakeOpenAI.calls[0].input.find((item: any) => item.type === 'message' && item.role === 'system');
    const promptText = firstSystem?.content?.[0]?.text ?? '';
    assert.match(promptText, /Checklist inicial obrigatório de auditoria do runner \(ambiente OK\)/i);
    assert.match(promptText, /tools essenciais: bash, git, rg/i);
    assert.match(promptText, /AWS CLI está disponível pelo comando aws/i);
    assert.match(promptText, /Docker CLI e o plugin Docker Compose v2 estão disponíveis/i);
    assert.match(promptText, /Você pode executar qualquer módulo do repositório no próprio ambiente para testar e ajustar a solução/i);
    assert.match(promptText, /GitHub CLI e o actionlint estão disponíveis/i);
    assert.match(promptText, /use gh para inspecionar repositórios, PRs, issues e workflows/i);
    assert.match(promptText, /use actionlint para validar arquivos de GitHub Actions antes de concluir ajustes em \.github\/workflows/i);
    assert.match(promptText, /O ffprobe está disponível para o modelo pelo comando ffprobe/i);
    assert.match(promptText, /use-o para inspecionar metadados, codecs, resolução, duração, streams/i);
    assert.match(promptText, /ferramentas Docker disponíveis:/i);
    assert.match(promptText, /ferramentas cloud disponíveis:/i);
    assert.match(promptText, /ferramentas GitHub\/CI disponíveis:/i);
    assert.match(promptText, /ferramentas de mídia disponíveis: ffprobe|ferramentas de mídia disponíveis: nenhuma detectada/i);
    assert.match(promptText, /credenciais AWS exportadas: (sim|não)/i);
    assert.match(promptText, /Playwright, @playwright\/test e Chromium headless em \/usr\/bin\/chromium/i);
    assert.match(promptText, /use Playwright com esse navegador para validar localmente/i);
    assert.match(promptText, /navegador headless disponível para screenshots: playwright, chromium|navegador headless disponível para screenshots: chromium/i);
    assert.match(promptText, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/i);
    assert.match(promptText, /NODE_PATH=\/usr\/local\/lib\/node_modules/i);
    assert.ok(job.logs.some((entry) => entry.includes('preflight do runner concluído com sucesso')));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('autocorrige cwd inválido em run_shell para o diretório validado do repositório', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-cwd-autocorrect-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'call-cwd-autocorrect',
                name: 'run_shell',
                arguments: JSON.stringify({ command: ['pwd'], cwd: '../fora-do-repo' }),
              },
              { type: 'message', id: 'msg-cwd-autocorrect', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-cwd-autocorrect-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-cwd-autocorrect',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'teste cwd',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.ok(job.logs.some((entry) => entry.includes('aplicando autocorreção imediata')));

    const toolOutput = fakeOpenAI.calls[1].input.find((item: any) => item.type === 'function_call_output');
    const parsed = JSON.parse(toolOutput.output);
    assert.equal(parsed.exitCode, 0);
    assert.equal(String(parsed.stdout).trim(), path.join(job.sandboxPath!, 'repo'));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('bloqueia retry cego após erros idênticos de tool com mesma assinatura', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-error-dedup-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length <= 3) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: `call-repeat-${fakeOpenAI.calls.length}`,
                name: 'run_shell',
                arguments: JSON.stringify({ command: ['comando-inexistente'], cwd: '.' }),
              },
              { type: 'message', id: `msg-repeat-${fakeOpenAI.calls.length}`, role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-repeat-final',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-error-dedup',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'teste dedup erro',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    const thirdTurnOutputs = fakeOpenAI.calls[3].input.filter((item: any) => item.type === 'function_call_output');
    const parsed = JSON.parse(thirdTurnOutputs[thirdTurnOutputs.length - 1].output);
    assert.match(parsed.error, /Runner bloqueou retry cego/i);
    assert.ok(job.logs.some((entry) => entry.includes('retry cego bloqueado')));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('db_query executa SELECT e contabiliza chamadas', async () => {
  const processor = new SandboxJobProcessor();
  const job: SandboxJob = {
    jobId: 'job-db-query',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    taskDescription: 'inspect database',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  job.database = {
    host: 'localhost',
    port: 3306,
    user: 'user',
    password: 'pass',
    database: 'db',
  };

  const fakeRows = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ];

  (processor as any).dbPools.set(job.jobId, {
    query: async () => [fakeRows],
  });

  const first = await (processor as any).handleDbQuery(
    { query: 'SELECT id, name FROM users', limit: 1 },
    job,
  );

  assert.equal(job.dbQueryCount, 1, 'db_query deve ser contabilizado');
  assert.equal(first.rowCount, 1);
  assert.equal(first.truncated, true);
  assert.deepEqual(first.columns, ['id', 'name']);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].name, 'Alice');

  const second = await (processor as any).handleDbQuery(
    { query: 'WITH users_cte AS (SELECT * FROM users) SELECT * FROM users_cte' },
    job,
  );

  assert.equal(job.dbQueryCount, 2, 'db_query deve acumular chamadas');
  assert.equal(second.truncated, false);
  assert.equal(second.rowCount, 2);
  assert.deepEqual(second.columns, ['id', 'name']);
});


test('executa testCommand configurado antes de concluir o job', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-testcmd-success-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async () => {
        fakeOpenAI.calls.push(null);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'write-testcmd',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'test command OK' }),
              },
              { type: 'message', id: 'msg-testcmd', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-testcmd-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-testcmd-success',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'touch file',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
    testCommand: 'ls',
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.ok(job.patch?.includes('test command OK'));
    assert.ok(job.logs.some((entry) => entry.includes('testCommand finalizado com sucesso')));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});


test('marca o job como falho quando o testCommand retorna erro', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-testcmd-fail-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async () => {
        fakeOpenAI.calls.push(null);
        if (fakeOpenAI.calls.length === 1) {
          return {
            output: [
              {
                type: 'function_call',
                call_id: 'write-testcmd-fail',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'README.md', content: 'broken change' }),
              },
              { type: 'message', id: 'msg-testcmd-fail', role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-testcmd-fail-2',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'summary', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-testcmd-failure',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'touch file',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
    testCommand: 'exit 7',
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'FAILED');
    assert.match(job.error ?? '', /testCommand/);
    assert.ok(job.patch?.includes('broken change'));
    assert.ok(job.logs.some((entry) => entry.includes('executando testCommand configurado')));
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('permite releitura após cooldown de estagnação', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-stagnation-reset-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'stable content');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const originalMax = process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS;
  const originalReset = process.env.INVESTIGATION_STAGNATION_RESET_MS;
  process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS = '3';
  process.env.INVESTIGATION_STAGNATION_RESET_MS = '5';

  const originalDateNow = Date.now;
  let mockNow = 1_000_000;
  (Date as unknown as { now: () => number }).now = () => mockNow;

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        if (fakeOpenAI.calls.length > 1) {
          mockNow += 10_000;
        }
        if (fakeOpenAI.calls.length <= 4) {
          const turn = fakeOpenAI.calls.length;
          return {
            output: [
              {
                type: 'function_call',
                call_id: `cooldown-${turn}`,
                name: 'read_file',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
              { type: 'message', id: `msg-cooldown-${turn}`, role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-cooldown-final',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'sem bloqueio', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-stagnation-reset',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'verifique se o cooldown libera novas hipóteses',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.ok(
      !job.logs.some((entry) => entry.includes('bloqueio por falta de nova evidência')),
      'não deveria registrar bloqueio por falta de evidências após o cooldown',
    );
    assert.ok(
      !job.logs.some((entry) => entry.includes('bloqueio de hipótese')),
      'não deveria bloquear hipóteses após o cooldown',
    );
  } finally {
    if (originalMax === undefined) {
      delete process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS;
    } else {
      process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS = originalMax;
    }
    if (originalReset === undefined) {
      delete process.env.INVESTIGATION_STAGNATION_RESET_MS;
    } else {
      process.env.INVESTIGATION_STAGNATION_RESET_MS = originalReset;
    }
    (Date as unknown as { now: () => number }).now = originalDateNow;
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('aplica limite ampliado para ferramentas de inspeção', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-inspection-limit-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'conteúdo estável');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const originalMax = process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS;
  const originalInspection = process.env.INVESTIGATION_INSPECTION_MAX_ATTEMPTS;
  process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS = '3';
  process.env.INVESTIGATION_INSPECTION_MAX_ATTEMPTS = '6';

  const steps: ('read' | 'shell')[] = [
    'read',
    'shell',
    'read',
    'shell',
    'read',
    'shell',
    'read',
    'shell',
    'read',
    'shell',
    'read',
    'shell',
    'read',
  ];

  const fakeOpenAI = {
    calls: [] as any[],
    responses: {
      create: async (payload: any) => {
        fakeOpenAI.calls.push(payload);
        const step = steps.shift();
        if (step === 'read') {
          const turn = fakeOpenAI.calls.length;
          return {
            output: [
              {
                type: 'function_call',
                call_id: `inspection-read-${turn}`,
                name: 'read_file',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
              { type: 'message', id: `msg-inspection-${turn}`, role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        if (step === 'shell') {
          const marker = `marker-${steps.length}`;
          return {
            output: [
              {
                type: 'function_call',
                call_id: marker,
                name: 'run_shell',
                arguments: JSON.stringify({ command: ['/bin/echo', marker], cwd: '.' }),
              },
              { type: 'message', id: `msg-shell-${marker}`, role: 'assistant', status: 'completed', content: [] },
            ],
          };
        }
        return {
          output: [
            {
              type: 'message',
              id: 'msg-inspection-final',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'pronto', annotations: [] }],
            },
          ],
        };
      },
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-inspection-limit',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'garanta que o limite maior só bloqueie após 6 tentativas de leitura',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    const readBlocks = job.logs.filter((entry) => entry.includes('bloqueio de hipótese') && entry.includes('read_file'));
    assert.ok(readBlocks.length >= 1, 'esperava bloqueio para read_file após exceder o limite ampliado');
    assert.ok(
      !job.logs.some((entry) => entry.includes('bloqueio de hipótese') && entry.includes('run_shell')),
      'o limite ampliado deve afetar apenas ferramentas de inspeção',
    );
  } finally {
    if (originalMax === undefined) {
      delete process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS;
    } else {
      process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS = originalMax;
    }
    if (originalInspection === undefined) {
      delete process.env.INVESTIGATION_INSPECTION_MAX_ATTEMPTS;
    } else {
      process.env.INVESTIGATION_INSPECTION_MAX_ATTEMPTS = originalInspection;
    }
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('persiste objetivo e conclusão em formato estruturado nas interações', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-interaction-audit-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'conteúdo inicial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const fakeOpenAI = {
    responses: {
      create: async () => ({
        output: [
          {
            type: 'message',
            id: 'msg-audit-final',
            role: 'assistant',
            status: 'completed',
            content: [{
              type: 'output_text',
              text: 'Objetivo da interação: validar a nova política de auditoria.\nConclusão da interação: política validada com sucesso.',
              annotations: [],
            }],
          },
        ],
      }),
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', fakeOpenAI);
  const job: SandboxJob = {
    jobId: 'job-interaction-audit',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'registre metadados de objetivo e conclusão',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);
    assert.equal(job.status, 'COMPLETED', job.error);
    assert.ok(job.interactions.length >= 1);

    const lastInteraction = job.interactions[job.interactions.length - 1]!;
    const inbound = JSON.parse(lastInteraction.content) as Record<string, unknown>;

    assert.equal(inbound.format, 'interaction-audit-v1');
    assert.equal(inbound.objective, 'validar a nova política de auditoria.');
    assert.equal(inbound.conclusion, 'política validada com sucesso.');
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});


test('resolve configuração de organização OpenAI para enviar no client', () => {
  const originalOrganization = process.env.OPENAI_ORGANIZATION;
  const originalOrgId = process.env.OPENAI_ORG_ID;
  const originalHubOrganizationId = process.env.HUB_ACCOUNT_OAUTH_ORGANIZATION_ID;
  try {
    process.env.OPENAI_ORGANIZATION = ' org-DgyTLAxNYnw0cOQVlAXInkyR ';
    process.env.OPENAI_ORG_ID = 'org-ignored';
    assert.equal(openAIClientConfigForTests.resolveOpenAIOrganization(), 'org-DgyTLAxNYnw0cOQVlAXInkyR');

    delete process.env.OPENAI_ORGANIZATION;
    process.env.OPENAI_ORG_ID = ' org-DgyTLAxNYnw0cOQVlAXInkyR ';
    assert.equal(openAIClientConfigForTests.resolveOpenAIOrganization(), 'org-DgyTLAxNYnw0cOQVlAXInkyR');

    delete process.env.OPENAI_ORG_ID;
    process.env.HUB_ACCOUNT_OAUTH_ORGANIZATION_ID = ' org-DgyTLAxNYnw0cOQVlAXInkyR ';
    assert.equal(openAIClientConfigForTests.resolveOpenAIOrganization(), 'org-DgyTLAxNYnw0cOQVlAXInkyR');
  } finally {
    if (originalOrganization === undefined) {
      delete process.env.OPENAI_ORGANIZATION;
    } else {
      process.env.OPENAI_ORGANIZATION = originalOrganization;
    }
    if (originalOrgId === undefined) {
      delete process.env.OPENAI_ORG_ID;
    } else {
      process.env.OPENAI_ORG_ID = originalOrgId;
    }
    if (originalHubOrganizationId === undefined) {
      delete process.env.HUB_ACCOUNT_OAUTH_ORGANIZATION_ID;
    } else {
      process.env.HUB_ACCOUNT_OAUTH_ORGANIZATION_ID = originalHubOrganizationId;
    }
  }
});

test('inclui estado do Codex App Server no healthcheck', async () => {
  const fakeCodexAppServerClient = {
    health: () => ({ status: 'ready', ready: true, restartAttempts: 0, initializedAt: '2026-06-22T00:00:00.000Z' }),
    isReady: () => true,
    request: async () => ({ authMode: 'chatgpt', planType: 'plus' }),
  } as any;
  const app = createApp({ processor: new StubProcessor(), codexAppServerClient: fakeCodexAppServerClient });
  const response = await request(app).get('/health').expect(200);

  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.codexAppServer.status, 'ready');
  assert.equal(response.body.codexAppServer.ready, true);
});

test('expõe account/read interno via Codex App Server sem tokens', async () => {
  const fakeCodexAppServerClient = {
    health: () => ({ status: 'ready', ready: true, restartAttempts: 0 }),
    isReady: () => true,
    request: async (method: string) => {
      assert.equal(method, 'account/read');
      return { authMode: 'chatgpt', planType: 'plus', accessToken: 'never-expose' };
    },
  } as any;
  const app = createApp({ processor: new StubProcessor(), codexAppServerClient: fakeCodexAppServerClient });
  const response = await request(app).get('/codex-app-server/account/read').expect(200);

  assert.equal(response.body.connected, true);
  assert.equal(response.body.executable, true);
  assert.equal(response.body.authMode, 'chatgpt');
  assert.ok(!('accessToken' in response.body), 'tokens must not be exposed');
});

test('inicia login device code via Codex App Server sem montar OAuth manual', async () => {
  const fakeCodexAppServerClient = {
    health: () => ({ status: 'ready', ready: true, restartAttempts: 0 }),
    isReady: () => true,
    request: async (method: string, params?: any) => {
      assert.equal(method, 'account/login/start');
      assert.deepEqual(params, { type: 'chatgptDeviceCode' });
      return { type: 'chatgptDeviceCode', loginId: 'login-123', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' };
    },
  } as any;
  const app = createApp({ processor: new StubProcessor(), codexAppServerClient: fakeCodexAppServerClient });
  const response = await request(app).post('/codex-app-server/account/login/start').send({ type: 'chatgptDeviceCode' }).expect(202);

  assert.equal(response.body.status, 'authorization_pending');
  assert.equal(response.body.loginId, 'login-123');
  assert.equal(response.body.userCode, 'ABCD-1234');
});

test('encaminha logout para Codex App Server', async () => {
  const calls: string[] = [];
  const fakeCodexAppServerClient = {
    health: () => ({ status: 'ready', ready: true, restartAttempts: 0 }),
    isReady: () => true,
    request: async (method: string) => {
      calls.push(method);
      if (method === 'account/logout') {
        return { ok: true };
      }
      if (method === 'account/read') {
        return {};
      }
      return {};
    },
  } as any;
  const app = createApp({ processor: new StubProcessor(), codexAppServerClient: fakeCodexAppServerClient });
  const response = await request(app).post('/codex-app-server/account/logout').send({}).expect(200);

  assert.deepEqual(calls, ['account/logout', 'account/read']);
  assert.equal(response.body.connected, false);
  assert.equal(response.body.executable, false);
});

test('lista modelos disponíveis do Codex App Server', async () => {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const fakeCodexAppServerClient = {
    health: () => ({ status: 'ready', ready: true, restartAttempts: 0 }),
    isReady: () => true,
    request: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'model/list') {
        return {
          data: [
            { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', hidden: false },
            { id: 'legacy-hidden', model: 'legacy-hidden', hidden: true },
          ],
          nextCursor: null,
        };
      }
      return {};
    },
  } as any;
  const app = createApp({ processor: new StubProcessor(), codexAppServerClient: fakeCodexAppServerClient });
  const response = await request(app).get('/codex-app-server/models').expect(200);

  assert.deepEqual(response.body, [{ id: 'gpt-5.6-sol', modelName: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' }]);
  assert.equal(calls[0]?.method, 'model/list');
  assert.equal((calls[0]?.params as { includeHidden?: boolean })?.includeHidden, false);
});

test('executa CHATGPT_CODEX via Codex App Server com thread/start e turn/start', async () => {
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-codex-app-server-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const listeners = new Map<string, Array<(params: unknown) => void>>();
  const calls: Array<{ method: string; params?: unknown }> = [];
  const fakeCodexAppServerClient = {
    isReady: () => true,
    request: async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === 'account/read') {
        return { authMode: 'chatgpt', planType: 'plus' };
      }
      if (method === 'thread/start') {
        return { id: 'thread-123' };
      }
      if (method === 'turn/start') {
        setTimeout(() => {
          for (const listener of listeners.get('item/agentMessage/delta') ?? []) {
            listener({ delta: 'resumo via app server' });
          }
          for (const listener of listeners.get('thread/tokenUsage/updated') ?? []) {
            listener({
              threadId: 'thread-123',
              turnId: 'turn-123',
              tokenUsage: {
                total: {
                  totalTokens: 47,
                  inputTokens: 30,
                  cachedInputTokens: 12,
                  outputTokens: 5,
                  reasoningOutputTokens: 0,
                },
                last: {
                  totalTokens: 47,
                  inputTokens: 30,
                  cachedInputTokens: 12,
                  outputTokens: 5,
                  reasoningOutputTokens: 0,
                },
                modelContextWindow: 128000,
              },
            });
          }
          for (const listener of listeners.get('turn/completed') ?? []) {
            listener({ status: 'completed', turnId: 'turn-123' });
          }
        }, 5);
        return { id: 'turn-123' };
      }
      throw new Error(`unexpected method ${method}`);
    },
    onNotification: (method: string, listener: (params: unknown) => void) => {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
      return () => listeners.set(method, (listeners.get(method) ?? []).filter((item) => item !== listener));
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', undefined, globalThis.fetch, fakeCodexAppServerClient);
  const job: SandboxJob = {
    jobId: 'job-chatgpt-codex-app-server',
    repoUrl: tempRepo,
    branch: 'main',
    taskDescription: 'use app server',
    imageAttachments: [{
      name: 'print.png',
      mimeType: 'image/png',
      size: 3,
      dataUrl: 'data:image/png;base64,QUJD',
    }, {
      name: 'briefing.txt',
      mimeType: 'text/plain',
      size: 11,
      dataUrl: 'data:text/plain;base64,YnJpZWZpbmc=',
    }],
    profile: 'CHATGPT_CODEX',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  try {
    await processor.process(job);

    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.summary, 'resumo via app server');
    assert.equal(job.promptTokens, 30);
    assert.equal(job.cachedPromptTokens, 12);
    assert.equal(job.completionTokens, 5);
    assert.equal(job.totalTokens, 47);
    const threadStartCall = calls.find((call) => call.method === 'thread/start');
    assert.ok(threadStartCall);
    assert.equal((threadStartCall.params as { sandbox?: string }).sandbox, 'danger-full-access');
    const turnStartCall = calls.find((call) => call.method === 'turn/start');
    assert.ok(turnStartCall);
    const input = (turnStartCall.params as { input?: Array<{ text?: string; type?: string; url?: string }> }).input;
    assert.ok(input?.[0]?.text?.includes('Modo Codex ChatGPT ativo'));
    assert.ok(input?.[0]?.text?.includes('melhor resposta possível'));
    assert.ok(input?.[0]?.text?.includes('sem encurtar a análise'));
    assert.ok(input?.[0]?.text?.includes('monte um ambiente local'));
    assert.ok(input?.[0]?.text?.includes('ajuste iterativamente até conseguir o funcionamento desejado'));
    assert.ok(input?.[0]?.text?.includes('Não criar Pull Request sem pedido explícito não significa evitar alterações'));
    assert.ok(input?.[0]?.text?.includes('altere os arquivos necessários'));
    assert.ok(input?.[0]?.text?.includes('apenas não abra nem publique o PR até o usuário pedir'));
    assert.ok(input?.[0]?.text?.includes('precisa passar por um Pull Request executado pelo usuário antes de ser publicada'));
    assert.ok(input?.[0]?.text?.includes('qualquer imagem usada em produção deve ser criada obrigatoriamente pelo código'));
    assert.ok(input?.[0]?.text?.includes('Dockerfile, Compose ou pipeline versionados neste repositório'));
    assert.ok(input?.[0]?.text?.includes('quando a solicitacao for criar um artefato dentro do Marketing Hub'));
    assert.ok(input?.[0]?.text?.includes('se o front-end ainda nao tiver a funcionalidade necessaria'));
    assert.ok(input?.[0]?.text?.includes('implemente essa funcionalidade, avise o usuario e aguarde o deploy'));
    assert.ok(input?.[0]?.text?.includes('quando a solicitacao for alterar uma funcionalidade de modulo'));
    assert.ok(input?.[0]?.text?.includes('Nunca use SSH para publicar diretamente uma alteracao'));
    assert.ok(input?.[0]?.text?.includes('use app server'));
    assert.ok(input?.[0]?.text?.includes('Arquivos anexados pelo usuário'));
    assert.ok(input?.[0]?.text?.includes('.codex/attachments/job-chatgpt-codex-app-server/briefing.txt'));
    assert.deepEqual(input?.[1], { type: 'image', url: 'data:image/png;base64,QUJD' });
    assert.equal(input?.length, 2);
    assert.ok(!calls.some((call) => call.method === 'responses.create'));
    assert.deepEqual(job.changedFiles, []);
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});

test('executa CHATGPT_CODEX_SANDBOX via Codex App Server sem clonar repositório', async () => {
  const listeners = new Map<string, Array<(params: unknown) => void>>();
  const calls: Array<{ method: string; params?: unknown }> = [];
  const fakeCodexAppServerClient = {
    isReady: () => true,
    request: async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === 'account/read') {
        return { authMode: 'chatgpt', planType: 'plus' };
      }
      if (method === 'thread/start') {
        return { id: 'thread-sandbox' };
      }
      if (method === 'turn/start') {
        setTimeout(() => {
          for (const listener of listeners.get('item/agentMessage/delta') ?? []) {
            listener({ delta: 'resultado sandbox' });
          }
          for (const listener of listeners.get('turn/completed') ?? []) {
            listener({ status: 'completed', turnId: 'turn-sandbox' });
          }
        }, 5);
        return { id: 'turn-sandbox' };
      }
      throw new Error(`unexpected method ${method}`);
    },
    onNotification: (method: string, listener: (params: unknown) => void) => {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
      return () => listeners.set(method, (listeners.get(method) ?? []).filter((item) => item !== listener));
    },
  } as any;

  const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', undefined, globalThis.fetch, fakeCodexAppServerClient);
  const job: SandboxJob = {
    jobId: 'job-chatgpt-codex-sandbox-app-server',
    taskDescription: 'rode uma solicitação avulsa',
    profile: 'CHATGPT_CODEX_SANDBOX',
    status: 'PENDING',
    logs: [],
    interactions: [],
    interactionSequence: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeoutCount: 0,
  } as SandboxJob;

  await processor.process(job);

  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, 'resultado sandbox');
  assert.deepEqual(job.changedFiles, []);
  assert.equal(job.patch, '');
  assert.ok(job.logs.some((entry) => entry.includes('sem Git')));
  assert.ok(!job.downloadLogs?.some((entry) => entry.source === 'git'));
  const threadStartCall = calls.find((call) => call.method === 'thread/start');
  assert.ok(threadStartCall);
  const cwd = (threadStartCall.params as { cwd?: string }).cwd;
  assert.ok(cwd?.endsWith('/sandbox'), `cwd esperado em /sandbox, recebido ${cwd}`);
  assert.equal(await fs.stat(path.join(cwd!, '.git')).then(() => true).catch(() => false), false);
  const turnStartCall = calls.find((call) => call.method === 'turn/start');
  assert.ok(turnStartCall);
  const input = (turnStartCall.params as { input?: Array<{ text?: string }> }).input;
  assert.ok(input?.[0]?.text?.includes('Modo Codex ChatGPT Sandbox ativo'));
  assert.ok(input?.[0]?.text?.includes('sem integração com Git'));
  assert.ok(input?.[0]?.text?.includes('sem clonar repositório'));
  assert.ok(input?.[0]?.text?.includes('quando a solicitacao for criar um artefato dentro do Marketing Hub'));
  assert.ok(input?.[0]?.text?.includes('se o front-end ainda nao tiver a funcionalidade necessaria'));
  assert.ok(input?.[0]?.text?.includes('implemente essa funcionalidade, avise o usuario e aguarde o deploy'));
  assert.ok(input?.[0]?.text?.includes('Nunca use SSH para publicar diretamente uma alteracao'));
  assert.ok(input?.[0]?.text?.includes('possui Playwright e @playwright/test instalados'));
  assert.ok(input?.[0]?.text?.includes('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'));
  assert.ok(input?.[0]?.text?.includes('Use Playwright para validações visuais, screenshots e testes de UI'));
  assert.ok(input?.[0]?.text?.includes('O ffprobe está disponível para o modelo pelo comando ffprobe'));
  assert.ok(input?.[0]?.text?.includes('rode uma solicitação avulsa'));
});

test('permite configurar sandbox mode do Codex App Server em kebab-case', async () => {
  const previous = process.env.CODEX_APP_SERVER_SANDBOX_MODE;
  process.env.CODEX_APP_SERVER_SANDBOX_MODE = 'workspace-write';
  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-codex-app-server-mode-'));
  execSync('git init', { cwd: tempRepo });
  execSync('git config user.email "ci@example.com"', { cwd: tempRepo });
  execSync('git config user.name "CI Bot"', { cwd: tempRepo });
  await fs.writeFile(path.join(tempRepo, 'README.md'), 'initial');
  execSync('git add README.md', { cwd: tempRepo });
  execSync('git commit -m "init"', { cwd: tempRepo });
  execSync('git branch -M main', { cwd: tempRepo });

  const listeners = new Map<string, Array<(params: unknown) => void>>();
  const calls: Array<{ method: string; params?: unknown }> = [];
  const fakeCodexAppServerClient = {
    isReady: () => true,
    request: async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === 'account/read') return { authMode: 'chatgpt', planType: 'plus' };
      if (method === 'thread/start') return { id: 'thread-123' };
      if (method === 'turn/start') {
        setTimeout(() => {
          for (const listener of listeners.get('turn/completed') ?? []) listener({ status: 'completed', turnId: 'turn-123' });
        }, 5);
        return { id: 'turn-123' };
      }
      throw new Error(`unexpected method ${method}`);
    },
    onNotification: (method: string, listener: (params: unknown) => void) => {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
      return () => listeners.set(method, (listeners.get(method) ?? []).filter((item) => item !== listener));
    },
  } as any;

  try {
    const processor = new SandboxJobProcessor(undefined, 'gpt-5-codex', undefined, globalThis.fetch, fakeCodexAppServerClient);
    const job: SandboxJob = {
      jobId: 'job-chatgpt-codex-app-server-mode',
      repoUrl: tempRepo,
      branch: 'main',
      taskDescription: 'use app server',
      profile: 'CHATGPT_CODEX',
      status: 'PENDING',
      logs: [],
      interactions: [],
      interactionSequence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeoutCount: 0,
    } as SandboxJob;

    await processor.process(job);
    const threadStartCall = calls.find((call) => call.method === 'thread/start');
    assert.ok(threadStartCall);
    assert.equal((threadStartCall.params as { sandbox?: string }).sandbox, 'workspace-write');
  } finally {
    if (previous === undefined) delete process.env.CODEX_APP_SERVER_SANDBOX_MODE;
    else process.env.CODEX_APP_SERVER_SANDBOX_MODE = previous;
    await fs.rm(tempRepo, { recursive: true, force: true });
  }
});
