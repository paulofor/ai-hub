import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { SandboxJob } from '../src/types.js';

const branch = 'ai-hub/recovery-test';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function fixture(t: TestContext, existing = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-code-preservation-'));
  const remote = path.join(directory, 'remote.git');
  const seed = path.join(directory, 'seed');
  await fs.mkdir(seed);
  git(directory, 'init', '--bare', remote);
  git(seed, 'init', '-b', 'main');
  git(seed, 'config', 'user.email', 'test@sandbox.local');
  git(seed, 'config', 'user.name', 'Sandbox test');
  await fs.writeFile(path.join(seed, 'base.txt'), 'base\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'fixture base');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', 'origin', 'main');
  if (existing) {
    git(seed, 'checkout', '-b', branch);
    await fs.writeFile(path.join(seed, 'previous.txt'), 'previous request\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'fixture previous request');
    git(seed, 'push', 'origin', branch);
  }
  const job: SandboxJob = {
    jobId: path.basename(directory), repoSlug: 'example/recovery-test', repoUrl: remote,
    branch: 'main', workBranch: branch, createPullRequest: false, githubToken: 'synthetic-token',
    taskDescription: 'synthetic local preservation test', status: 'PENDING',
    logs: [], interactions: [], interactionSequence: 0, timeoutCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const processor = new SandboxJobProcessor(undefined, 'test-model', {} as any, async () => {
    assert.fail('No GitHub HTTP request is allowed in this fixture');
  });
  t.after(async () => {
    if (job.sandboxPath) await fs.rm(job.sandboxPath, { recursive: true, force: true });
    await fs.rm(directory, { recursive: true, force: true });
  });
  const model = (implementation: (repo: string) => Promise<void>) => {
    (processor as any).runWithOpenAIResponsesApi = async (_job: SandboxJob, repo: string) => {
      await implementation(repo);
      return 'Synthetic code ready';
    };
  };
  const commit = async (repo: string) => {
    git(repo, 'config', 'user.email', 'test@sandbox.local');
    git(repo, 'config', 'user.name', 'Sandbox test');
    await fs.writeFile(path.join(repo, 'model.txt'), 'validated model commit\n');
    git(repo, 'add', 'model.txt');
    git(repo, 'commit', '-m', 'fixture model commit');
    return git(repo, 'rev-parse', 'HEAD');
  };
  return { directory, remote, seed, job, processor, model, commit };
}

test('preserves model commits and pending edits when publishing an existing work branch', async (t) => {
  const f = await fixture(t);
  let modelCommit = '';
  f.model(async (repo) => {
    git(repo, 'checkout', '-b', 'codex/isolated-validated');
    modelCommit = await f.commit(repo);
    await fs.writeFile(path.join(repo, 'base.txt'), 'pending tracked edit\n');
    await fs.writeFile(path.join(repo, 'new.txt'), 'pending new file\n');
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  git(f.remote, 'merge-base', '--is-ancestor', modelCommit, `refs/heads/${branch}`);
  assert.equal(git(f.remote, 'show', `${branch}:model.txt`), 'validated model commit');
  assert.equal(git(f.remote, 'show', `${branch}:base.txt`), 'pending tracked edit');
  assert.equal(git(f.remote, 'show', `${branch}:new.txt`), 'pending new file');
  assert.equal(git(f.remote, 'show', `${branch}:previous.txt`), 'previous request');
  assert.ok(f.job.patch?.includes('validated model commit'));
});

test('publishes a new work branch without rewriting the model commit', async (t) => {
  const f = await fixture(t, false);
  let modelCommit = '';
  f.model(async (repo) => { modelCommit = await f.commit(repo); });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  git(f.remote, 'merge-base', '--is-ancestor', modelCommit, `refs/heads/${branch}`);
  assert.equal(git(f.remote, 'show', `${branch}:model.txt`), 'validated model commit');
});

test('keeps both revisions and reports failure when another job advances the remote', async (t) => {
  const f = await fixture(t);
  let modelCommit = '';
  let concurrentCommit = '';
  f.model(async (repo) => {
    modelCommit = await f.commit(repo);
    await fs.writeFile(path.join(f.seed, 'concurrent.txt'), 'another job\n');
    git(f.seed, 'add', '.');
    git(f.seed, 'commit', '-m', 'fixture concurrent job');
    git(f.seed, 'push', 'origin', branch);
    concurrentCommit = git(f.seed, 'rev-parse', 'HEAD');
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'FAILED');
  assert.equal(git(f.remote, 'rev-parse', `refs/heads/${branch}`), concurrentCommit);
  const repo = path.join(f.job.sandboxPath!, 'repo');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), modelCommit);
  assert.equal(await fs.readFile(path.join(repo, 'model.txt'), 'utf8'), 'validated model commit\n');
  assert.ok(f.job.patch?.includes('validated model commit'));
});

test('does not treat remote unavailability as an absent work branch', async (t) => {
  const f = await fixture(t);
  f.model(async (repo) => {
    await f.commit(repo);
    await fs.rename(f.remote, `${f.remote}.unavailable`);
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'FAILED');
  assert.equal(await fs.readFile(path.join(f.job.sandboxPath!, 'repo/model.txt'), 'utf8'), 'validated model commit\n');
});

test('keeps the workspace and patch when a push is rejected', async (t) => {
  const f = await fixture(t);
  const initialHead = git(f.remote, 'rev-parse', `refs/heads/${branch}`);
  await fs.writeFile(path.join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  f.model(async (repo) => { await f.commit(repo); });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'FAILED');
  assert.equal(git(f.remote, 'rev-parse', `refs/heads/${branch}`), initialHead);
  assert.equal(await fs.readFile(path.join(f.job.sandboxPath!, 'repo/model.txt'), 'utf8'), 'validated model commit\n');
  assert.ok(f.job.patch?.includes('validated model commit'));
});

test('keeps unpublished changes when no GitHub credential is configured', async (t) => {
  const f = await fixture(t);
  (f.processor as any).resolveGithubAuth = () => ({ username: 'test', source: 'none' });
  const initialHead = git(f.remote, 'rev-parse', `refs/heads/${branch}`);
  f.model(async (repo) => { await f.commit(repo); });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(git(f.remote, 'rev-parse', `refs/heads/${branch}`), initialHead);
  assert.equal(await fs.readFile(path.join(f.job.sandboxPath!, 'repo/model.txt'), 'utf8'), 'validated model commit\n');
});

test('keeps recoverable code after local validation fails and never pushes it', async (t) => {
  const f = await fixture(t);
  const initialHead = git(f.remote, 'rev-parse', `refs/heads/${branch}`);
  f.job.testCommand = 'exit 7';
  f.model(async (repo) => { await f.commit(repo); });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'FAILED');
  assert.equal(git(f.remote, 'rev-parse', `refs/heads/${branch}`), initialHead);
  assert.equal(await fs.readFile(path.join(f.job.sandboxPath!, 'repo/model.txt'), 'utf8'), 'validated model commit\n');
  assert.ok(f.job.patch?.includes('validated model commit'));
});
