import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import type { SandboxJob, SandboxProfile } from '../src/types.js';

const healthScript = path.resolve('scripts/sandbox-node-health');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node-runtime-test-'));
  const install = path.join(root, 'persistent');
  await fs.mkdir(path.join(install, 'bin'), { recursive: true });
  for (const tool of ['node', 'npm', 'npx']) {
    await fs.writeFile(path.join(install, 'bin', tool), '#!/bin/sh\nprintf "test-version\\n"\n', { mode: 0o755 });
  }
  const env = { ...process.env, PATH: `${install}/bin:${process.env.PATH}`, SANDBOX_NODE_INSTALL_ROOT: install };
  return { root, install, env, run: () => spawnSync('/bin/bash', [healthScript], { env, encoding: 'utf8' }) };
}

test('aceita instalação persistente com links internos e permanece válida após limpar outro job', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.install, 'lib'));
    await fs.rename(path.join(f.install, 'bin/npm'), path.join(f.install, 'lib/npm'));
    await fs.symlink('../lib/npm', path.join(f.install, 'bin/npm'));
    await fs.mkdir(path.join(f.root, 'job-a'));
    assert.equal(f.run().status, 0);
    await fs.rm(path.join(f.root, 'job-a'), { recursive: true });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[NODE\] node.*persistent\/bin\/node/);
    assert.match(result.stdout, /\[NODE\] npm.*persistent\/lib\/npm/);
    assert.match(result.stdout, /\[NODE\] npx/);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

for (const tool of ['node', 'npm', 'npx']) {
  test(`rejeita ${tool} vinculado ao workspace de outro job, antes e depois da limpeza`, async () => {
    const f = await fixture();
    try {
      const jobDir = path.join(f.root, 'job-a');
      await fs.mkdir(jobDir);
      const target = path.join(jobDir, tool);
      await fs.rename(path.join(f.install, 'bin', tool), target);
      await fs.symlink(target, path.join(f.install, 'bin', tool));
      const before = f.run();
      assert.equal(before.status, 1);
      assert.match(before.stderr, new RegExp(`\\[NODE\\] ${tool} indisponível ou fora`));
      await fs.rm(jobDir, { recursive: true });
      const after = f.run();
      assert.equal(after.status, 1);
      assert.match(after.stderr, new RegExp(`\\[NODE\\] ${tool} indisponível ou fora`));
    } finally {
      await fs.rm(f.root, { recursive: true, force: true });
    }
  });
}

test('rejeita comando ausente e CLI que falha ao executar', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.install, 'bin/node'), '#!/bin/sh\nexit 42\n');
    assert.equal(f.run().status, 42);
    await fs.rm(path.join(f.install, 'bin/node'));
    assert.equal(f.run().status, 1);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('preflight registra versão saudável e interrompe todos os runners antes de clone ou inferência', async () => {
  const f = await fixture();
  const previousPath = process.env.PATH;
  const previousWorkdir = process.env.SANDBOX_WORKDIR;
  const helper = path.join(f.install, 'bin/sandbox-node-health');
  try {
    process.env.PATH = f.env.PATH;
    process.env.SANDBOX_WORKDIR = f.root;
    await fs.writeFile(helper, '#!/bin/sh\nprintf "[NODE] node test-version persistent\\n"\n', { mode: 0o755 });
    const healthy = new SandboxJobProcessor();
    const healthyJob = { jobId: 'healthy-node-fixture', logs: [] } as unknown as SandboxJob;
    await (healthy as any).validateNodeRuntime(healthyJob);
    assert.ok(healthyJob.logs.some((line) => line.includes('[NODE] node test-version')));

    await fs.writeFile(helper, '#!/bin/sh\nprintf "[NODE] node aponta para job removido\\n" >&2\nexit 1\n');
    for (const profile of ['STANDARD', 'CHATGPT_CODEX', 'CHATGPT_CODEX_MKT', 'CHATGPT_CODEX_SANDBOX'] as SandboxProfile[]) {
      const processor = new SandboxJobProcessor();
      let downstreamCalled = false;
      for (const method of ['cloneRepository', 'runWithCodexAppServer', 'runWithOpenAIResponsesApi']) {
        (processor as any)[method] = async () => { downstreamCalled = true; throw new Error('não deve ser chamado'); };
      }
      (processor as any).cleanupDockerHomologation = async () => {};
      const job = { jobId: `broken-node-${profile}`, profile, taskDescription: 'Teste sintético de Node', logs: [] } as unknown as SandboxJob;
      await processor.process(job);
      assert.equal(job.status, 'FAILED');
      assert.match(job.error ?? '', /instalação persistente de Node\/npm\/npx inválida/);
      assert.match(job.error ?? '', /job removido/);
      assert.equal(downstreamCalled, false);
      assert.equal(job.totalTokens ?? 0, 0);
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousWorkdir === undefined) delete process.env.SANDBOX_WORKDIR; else process.env.SANDBOX_WORKDIR = previousWorkdir;
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('preserva toolchains de desenvolvimento que não usam o helper da imagem', async () => {
  const processor = new SandboxJobProcessor();
  (processor as any).isCommandAvailable = async () => false;
  await (processor as any).validateNodeRuntime({ logs: [] });
});

test('orientação protege ferramentas globais em todos os perfis App Server', () => {
  const processor = new SandboxJobProcessor();
  for (const profile of ['CHATGPT_CODEX', 'CHATGPT_CODEX_MKT', 'CHATGPT_CODEX_SANDBOX'] as SandboxProfile[]) {
    const input = (processor as any).buildCodexAppServerInput({ jobId: 'node-prompt-fixture', profile, taskDescription: 'Teste' })[0].text;
    assert.match(input, /Nunca substitua os executáveis ou atalhos compartilhados/);
    assert.match(input, /PATH apenas do comando ou processo desse job/);
    assert.match(input, /sandbox-node-health/);
  }
});
