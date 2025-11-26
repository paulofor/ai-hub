import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { SandboxJob } from '../src/types.js';

const createJob = (): SandboxJob => ({
  jobId: `job-${Date.now()}`,
  repoUrl: 'https://example.com/repo.git',
  branch: 'main',
  taskDescription: 'shell test',
  status: 'PENDING',
  logs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

test('normalizeShellCommand substitui grep -R por rg e registra log', () => {
  const processor = new SandboxJobProcessor();
  const job = createJob();

  const normalized = (processor as any).normalizeShellCommand(['grep', '-R', 'hello', '.'], job);

  assert.deepEqual(normalized, ['rg', 'hello', '.']);
  assert.ok(
    job.logs.some((entry) => entry.includes('grep -R detectado') && entry.includes('rg hello .')),
    'log de substituição não encontrado',
  );
});

test('normalizeShellCommand rejeita grep -R sem argumentos e orienta uso de rg', () => {
  const processor = new SandboxJobProcessor();
  const job = createJob();

  assert.throws(
    () => (processor as any).normalizeShellCommand(['grep', '-R'], job),
    /utilize "rg"/,
  );
  assert.ok(
    job.logs.some((entry) => entry.includes('grep -R') && entry.includes('rg')),
    'log de rejeição não encontrado',
  );
});

test('handleRunShell utiliza comando normalizado antes de executar', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'run-shell-rg-'));
  const processor = new SandboxJobProcessor();
  const job = createJob();
  let normalized: string[] | undefined;

  (processor as any).normalizeShellCommand = (command: string[]) => {
    normalized = command;
    return ['echo', 'ok'];
  };

  const result = await (processor as any).handleRunShell(
    { command: ['should', 'normalize'], cwd: '.' },
    repoPath,
    job,
  );

  assert.deepEqual(normalized, ['should', 'normalize']);
  assert.equal(result.stdout.trim(), 'ok');

  await fs.rm(repoPath, { recursive: true, force: true });
});
