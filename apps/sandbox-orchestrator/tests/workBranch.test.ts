import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxJobProcessor } from '../src/jobProcessor.js';
import { SandboxJob, SandboxProfile } from '../src/types.js';

const branch = 'ai-hub/recovery-test';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

type Fetch = NonNullable<ConstructorParameters<typeof SandboxJobProcessor>[3]>;

async function fixture(t: TestContext, existing = true, github?: (remote: string) => Fetch) {
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
  const processor = new SandboxJobProcessor(undefined, 'test-model', {} as any, github?.(remote) ?? (async () => {
    assert.fail('No GitHub HTTP request is allowed in this fixture');
  }));
  // Exercise the real preflight fallback independently of the host's packages.
  const available = (processor as any).isCommandAvailable.bind(processor);
  (processor as any).isCommandAvailable = (command: string) => command === 'rg' ? false : available(command);
  (processor as any).cleanupDockerHomologation = async () => {};
  t.after(async () => {
    if (job.sandboxPath) await fs.rm(job.sandboxPath, { recursive: true, force: true });
    await fs.rm(directory, { recursive: true, force: true });
  });
  const model = (implementation: (repo: string) => Promise<void>) => {
    (processor as any).runWithOpenAIResponsesApi = async (_job: SandboxJob, repo: string) => {
      await implementation(repo);
      return 'Synthetic code ready';
    };
    (processor as any).runWithCodexAppServer = (processor as any).runWithOpenAIResponsesApi;
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

function githubFixture() {
  const calls: { method: string; url: URL }[] = [];
  let openPr: { html_url: string } | undefined;
  let onCreate: (() => any) | undefined;
  let onRead: ((url: URL) => any) | undefined;
  const response = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
  });
  const noCommits = () => response(422, { message: 'Validation Failed', errors: [
    { resource: 'PullRequest', code: 'custom', message: `No commits between main and ${branch}` },
  ] });
  const fetch = (remote: string): Fetch => async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    assert.equal(init?.headers?.Authorization, 'Bearer synthetic-token');
    if (method === 'GET' && onRead) return onRead(url);
    if (method === 'GET' && url.pathname.endsWith('/pulls')) {
      assert.equal(url.searchParams.get('state'), 'open');
      assert.equal(url.searchParams.get('head'), `example:${branch}`);
      assert.equal(url.searchParams.get('base'), 'main');
      return response(200, openPr ? [openPr] : []);
    }
    const ahead = Number(git(remote, 'rev-list', '--count', `main..${branch}`));
    const changed = git(remote, 'diff', '--name-only', `main...${branch}`);
    if (method === 'GET' && url.pathname.includes('/compare/')) {
      assert.ok(decodeURIComponent(url.pathname).endsWith(`/compare/main...${branch}`));
      return response(200, { ahead_by: ahead, files: changed ? changed.split('\n').map(filename => ({ filename })) : [] });
    }
    assert.equal(method, 'POST');
    assert.ok(url.pathname.endsWith('/pulls'));
    if (onCreate) return onCreate();
    if (!ahead || !changed) return noCommits();
    return response(201, { html_url: 'https://github.com/example/recovery-test/pull/1' });
  };
  return { calls, fetch, response, noCommits,
    setOpenPr: (value: { html_url: string }) => { openPr = value; },
    setOnCreate: (value: () => any) => { onCreate = value; },
    setOnRead: (value: (url: URL) => any) => { onRead = value; },
  };
}

const profiles: SandboxProfile[] = ['STANDARD', 'ECONOMY', 'SMART_ECONOMY', 'ECO_1', 'ECO_2', 'ECO_3', 'CHATGPT_CODEX', 'CHATGPT_CODEX_MKT'];

test('completes unchanged identical branches without GitHub calls', async (t) => {
  const f = await fixture(t);
  f.job.createPullRequest = true;
  git(f.seed, 'checkout', 'main');
  git(f.seed, 'merge', '--ff-only', branch);
  git(f.seed, 'push', 'origin', 'main');
  f.model(async () => {});
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(f.job.patch, '');
  assert.equal(f.job.pullRequestUrl, undefined);
});

for (const profile of profiles) {
  test(`does not create a PR for a merged branch behind main (${profile})`, async (t) => {
    const api = githubFixture();
    const f = await fixture(t, true, api.fetch);
    f.job.profile = profile;
    f.job.createPullRequest = true;
    git(f.seed, 'checkout', 'main');
    git(f.seed, 'merge', '--ff-only', branch);
    await fs.writeFile(path.join(f.seed, 'later.txt'), 'another delivered request\n');
    git(f.seed, 'add', '.');
    git(f.seed, 'commit', '-m', 'fixture later request');
    git(f.seed, 'push', 'origin', 'main');
    const main = git(f.remote, 'rev-parse', 'main');
    f.model(async () => {});
    await f.processor.process(f.job);
    assert.equal(f.job.status, 'COMPLETED', f.job.error);
    assert.equal(f.job.error, undefined);
    assert.ok(f.job.patch?.includes('later.txt'), 'historical diff must remain available');
    assert.equal(api.calls.filter(call => call.method === 'POST').length, 0);
    assert.equal(git(f.remote, 'rev-parse', 'main'), main);
    assert.ok(f.job.logs.some(line => line.includes('sem commits novos')));
    await assert.rejects(fs.stat(f.job.sandboxPath!), { code: 'ENOENT' });
  });
}

test('does not create a second PR when the model merges during the job', async (t) => {
  const api = githubFixture();
  const f = await fixture(t, false, api.fetch);
  f.job.createPullRequest = true;
  f.model(async (repo) => {
    git(repo, 'checkout', '-b', branch);
    await f.commit(repo);
    git(repo, 'push', 'origin', branch);
    git(f.seed, 'fetch', 'origin', branch);
    git(f.seed, 'merge', '--no-ff', '-m', 'fixture merged PR', 'FETCH_HEAD');
    git(f.seed, 'push', 'origin', 'main');
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.ok(f.job.patch?.includes('model.txt'));
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 0);
});

test('reuses an open PR without attempting a duplicate POST', async (t) => {
  const api = githubFixture();
  api.setOpenPr({ html_url: 'https://github.com/example/recovery-test/pull/7' });
  const f = await fixture(t, true, api.fetch);
  f.job.createPullRequest = true;
  f.model(async (repo) => { await f.commit(repo); });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(f.job.pullRequestUrl, 'https://github.com/example/recovery-test/pull/7');
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(git(f.remote, 'show', `${branch}:model.txt`), 'validated model commit');
});

test('creates exactly one PR after comparing new remote changes', async (t) => {
  const api = githubFixture();
  const f = await fixture(t, false, api.fetch);
  f.job.createPullRequest = true;
  f.model(async (repo) => { await f.commit(repo); });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(f.job.pullRequestUrl, 'https://github.com/example/recovery-test/pull/1');
  assert.deepEqual(api.calls.map(call => call.method), ['GET', 'GET', 'POST']);
});

test('publishes real changes without staging internal fallback tools or attachments', async (t) => {
  const api = githubFixture();
  const f = await fixture(t, false, api.fetch);
  f.job.createPullRequest = true;
  f.model(async (repo) => {
    const fallback = path.join(repo, '.ai-hub-bin/rg');
    execFileSync('bash', ['-n', fallback]);
    execFileSync('shellcheck', [fallback]);
    await fs.mkdir(path.join(repo, '.codex/attachments'), { recursive: true });
    await fs.writeFile(path.join(repo, '.codex/attachments/test.txt'), 'synthetic attachment\n');
    await fs.writeFile(path.join(repo, 'new file.txt'), 'new source\n');
    // Internal files may already have been staged by a model command.
    git(repo, 'add', '-A');
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(git(f.remote, 'ls-tree', '-r', '--name-only', branch), 'base.txt\nnew file.txt');
  assert.ok(!f.job.patch?.includes('.ai-hub-bin'));
  assert.ok(!f.job.changedFiles?.some(file => file.startsWith('.codex/')));
});

test('rechecks a merge racing with PR creation instead of failing the job', async (t) => {
  const api = githubFixture();
  const f = await fixture(t, false, api.fetch);
  f.job.createPullRequest = true;
  f.model(async (repo) => { await f.commit(repo); });
  api.setOnCreate(() => {
    git(f.seed, 'fetch', 'origin', branch);
    git(f.seed, 'merge', '--ff-only', 'FETCH_HEAD');
    git(f.seed, 'push', 'origin', 'main');
    return api.noCommits();
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(api.calls.filter(call => call.url.pathname.includes('/compare/')).length, 2);
});

test('reuses a PR opened between the initial lookup and POST', async (t) => {
  const api = githubFixture();
  const f = await fixture(t, false, api.fetch);
  f.job.createPullRequest = true;
  f.model(async (repo) => { await f.commit(repo); });
  api.setOnCreate(() => {
    api.setOpenPr({ html_url: 'https://github.com/example/recovery-test/pull/8' });
    return api.response(422, { errors: [{ resource: 'PullRequest', code: 'custom', message: 'A pull request already exists' }] });
  });
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(f.job.pullRequestUrl, 'https://github.com/example/recovery-test/pull/8');
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 1);
});

for (const noCommits of [false, true]) {
  test(`preserves an unconfirmed 422 and recoverable workspace (noCommits=${noCommits})`, async (t) => {
    const api = githubFixture();
    const f = await fixture(t, false, api.fetch);
    f.job.createPullRequest = true;
    f.model(async (repo) => { await f.commit(repo); });
    api.setOnCreate(() => noCommits ? api.noCommits() : api.response(422, { errors: [{ resource: 'PullRequest', code: 'invalid', field: 'head' }] }));
    await f.processor.process(f.job);
    assert.equal(f.job.status, 'FAILED');
    assert.match(f.job.error!, /Falha ao criar PR: 422/);
    assert.equal(api.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(await fs.readFile(path.join(f.job.sandboxPath!, 'repo/model.txt'), 'utf8'), 'validated model commit\n');
  });
}

for (const endpoint of ['pulls', 'compare']) {
  for (const failure of ['401', '403', 'network', 'invalid-json', 'invalid-shape']) {
    test(`fails closed when ${endpoint} returns ${failure}`, async (t) => {
      const api = githubFixture();
      const f = await fixture(t, false, api.fetch);
      f.job.createPullRequest = true;
      f.model(async (repo) => { await f.commit(repo); });
      api.setOnRead(url => {
        if (endpoint === 'compare' && url.pathname.endsWith('/pulls')) return api.response(200, []);
        if (failure === 'network') throw new Error('synthetic connection failure');
        if (failure === 'invalid-json') return { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } };
        if (failure === 'invalid-shape') return api.response(200, {});
        return api.response(Number(failure), {});
      });
      await f.processor.process(f.job);
      assert.equal(f.job.status, 'FAILED');
      assert.equal(api.calls.filter(call => call.method === 'POST').length, 0);
      assert.equal(await fs.readFile(path.join(f.job.sandboxPath!, 'repo/model.txt'), 'utf8'), 'validated model commit\n');
      assert.ok(!f.job.logs.join('\n').includes('synthetic-token'));
    });
  }
}

test('does not open an empty PR for commits whose changes were reverted', async (t) => {
  const api = githubFixture();
  const f = await fixture(t, true, api.fetch);
  f.job.createPullRequest = true;
  git(f.seed, 'revert', '--no-edit', 'HEAD');
  git(f.seed, 'push', 'origin', branch);
  git(f.seed, 'checkout', 'main');
  await fs.writeFile(path.join(f.seed, 'later.txt'), 'later main change\n');
  git(f.seed, 'add', '.');
  git(f.seed, 'commit', '-m', 'fixture main change');
  git(f.seed, 'push', 'origin', 'main');
  f.model(async () => {});
  await f.processor.process(f.job);
  assert.equal(f.job.status, 'COMPLETED', f.job.error);
  assert.equal(api.calls.filter(call => call.method === 'POST').length, 0);
  assert.ok(f.job.logs.some(line => line.includes('sem arquivos alterados')));
});
