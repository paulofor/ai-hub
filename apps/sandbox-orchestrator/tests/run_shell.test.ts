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
  taskDescription: 'validate run_shell behavior',
  status: 'PENDING',
  logs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

test('substitui grep -R por rg com log explicativo', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-grep-rg-'));
  await fs.writeFile(path.join(repoPath, 'sample.txt'), 'buscar valor aqui');

  const processor = new SandboxJobProcessor();
  const job = createJob();

  const result = await (processor as any).handleRunShell(
    { command: ['grep', '-R', 'buscar', '.'], cwd: '.' },
    repoPath,
    job,
  );

  assert.equal(result.exitCode, 0, 'rg deveria executar com sucesso');
  assert.ok(result.stdout.includes('buscar valor aqui'), 'stdout deve conter o resultado do rg');
  const substitutionLog = job.logs.find((entry) => entry.includes('grep -R detectado; substituindo por rg'));
  assert.ok(substitutionLog, 'log de substituição para rg não encontrado');

  await fs.rm(repoPath, { recursive: true, force: true });
});

test('recusa grep -R sem argumentos adicionais com orientação de uso do rg', async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-grep-reject-'));
  const processor = new SandboxJobProcessor();
  const job = createJob();

  await assert.rejects(
    () => (processor as any).handleRunShell({ command: ['grep', '-R'], cwd: '.' }, repoPath, job),
    /Use rg <padrao> <caminho> para buscas recursivas no sandbox/,
  );

  const refusalLog = job.logs.find((entry) => entry.includes('grep -R detectado. Use rg'));
  assert.ok(refusalLog, 'log de recusa do grep -R não encontrado');

  await fs.rm(repoPath, { recursive: true, force: true });
});
