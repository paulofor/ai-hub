import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createApp } from '../src/server.js';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { JobProcessor, SandboxJob } from '../src/types.js';

class StubProcessor implements JobProcessor {
  async process(job: SandboxJob): Promise<void> {
    job.status = 'COMPLETED';
    job.summary = 'ok';
    job.changedFiles = ['README.md'];
    job.updatedAt = new Date().toISOString();
  }
}

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

test('rejects invalid payload', async () => {
  const app = createApp({ processor: new StubProcessor() });
  await request(app).post('/jobs').send({}).expect(400);
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changedFiles: [],
  });

  const response = await request(app).get('/jobs/job-1').expect(200);
  assert.equal(response.body.jobId, 'job-1');
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
            id: 'resp-1',
            output: [
              {
                type: 'function_call',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path: 'README.md', content: 'updated content' }),
                },
              },
              { text: 'updating file' },
            ],
          };
        }
        return { id: 'resp-2', output: [{ text: 'summary ready' }] };
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as SandboxJob;

  await processor.process(job);

  const firstCall = fakeOpenAI.calls[0];
  assert.ok(firstCall.tools, 'tools ausente na chamada inicial');
  assert.deepEqual(
    firstCall.tools.map((tool: any) => tool.name).filter(Boolean),
    ['run_shell', 'read_file', 'write_file']
  );

  assert.equal(job.status, 'COMPLETED', job.error);
  assert.equal(job.summary, 'summary ready');
  assert.ok(job.patch && job.patch.includes('updated content'));
  assert.ok(job.logs.some((entry) => entry.includes('write_file')));

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
            id: 'resp-read-1',
            output: [
              {
                type: 'function_call',
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'README.md' }),
                },
              },
            ],
          };
        }
        return { id: 'resp-read-2', output: [{ text: 'done' }] };
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as SandboxJob;

  await processor.process(job);

  const secondCall = fakeOpenAI.calls[1];
  assert.ok(secondCall.tool_outputs, 'tool_outputs ausente no retorno do read_file');
  assert.equal(secondCall.input, '', 'chamada subsequente deve incluir input vazio');
  const parsedOutput = JSON.parse(secondCall.tool_outputs[0].output);
  assert.equal(parsedOutput.path, 'README.md');
  assert.equal(parsedOutput.content, 'initial');

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
            id: 'resp-error-1',
            output: [
              {
                type: 'function_call',
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'package.json' }),
                },
              },
            ],
          };
        }
        const toolOutput = payload.tool_outputs?.[0]?.output;
        const parsed = toolOutput ? JSON.parse(toolOutput) : {};
        return { id: 'resp-error-2', output: [{ text: parsed.error ? 'handled missing file' : 'no error' }] };
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as SandboxJob;

  await processor.process(job);

  const secondCall = fakeOpenAI.calls[1];
  assert.ok(secondCall.tool_outputs, 'tool_outputs ausente no retorno do erro');
  const parsedOutput = JSON.parse(secondCall.tool_outputs[0].output);
  assert.ok(parsedOutput.error, 'tool error deve ser retornado ao modelo');
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.summary, 'handled missing file');

  await fs.rm(tempRepo, { recursive: true, force: true });
});
