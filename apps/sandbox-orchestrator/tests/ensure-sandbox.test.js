import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/server.js';
import { SandboxProvider } from '../src/sandboxProvider.js';

process.env.NODE_ENV = 'test';

const buildApp = (options = {}) => {
  const cache = options.cache ?? new Map();
  const provider =
    options.provider ??
    new SandboxProvider({
      cache,
      slugSuffix: options.slugSuffix,
      host: 'sandbox.local',
      basePort: 9000,
    });

  return createApp({
    slugSuffix: options.slugSuffix,
    cache,
    sandboxProvider: provider,
  });
};

test('returns a sandbox payload with connection info', async () => {
  const app = buildApp({ slugSuffix: '-sandbox' });

  const response = await request(app)
    .post('/api/v1/sandboxes/ensure')
    .send({ slug: 'owner/repo' })
    .expect(200);

  assert.equal(response.body.slug, 'owner/repo-sandbox');
  assert.equal(response.body.host, 'sandbox.local');
  assert.equal(response.body.port, 9000);
  assert.ok(response.body.token);
});

test('caches provisioned sandboxes per original slug', async () => {
  const cache = new Map();
  const app = buildApp({ cache, slugSuffix: '-env' });

  const first = await request(app)
    .post('/api/v1/sandboxes/ensure')
    .send({ slug: 'owner/repo' })
    .expect(200);

  cache.set('owner/repo', {
    slug: 'custom-sandbox',
    host: 'cache.local',
    port: 3333,
    token: 'cached-token',
    expiresAt: Date.now() + 10000,
  });

  const second = await request(app)
    .post('/api/v1/sandboxes/ensure')
    .send({ slug: 'owner/repo' })
    .expect(200);

  assert.equal(first.body.slug, 'owner/repo-env');
  assert.equal(second.body.slug, 'custom-sandbox');
  assert.equal(second.body.host, 'cache.local');
  assert.equal(second.body.port, 3333);
  assert.equal(second.body.token, 'cached-token');
});

test('rejects invalid payloads', async () => {
  const app = buildApp();

  await request(app).post('/api/v1/sandboxes/ensure').send({}).expect(400);
  await request(app).post('/api/v1/sandboxes/ensure').send({ slug: '  ' }).expect(400);
});

test('creates unique sandboxes per branch', async () => {
  const app = buildApp({ slugSuffix: '-sandbox' });

  const main = await request(app)
    .post('/api/v1/sandboxes/ensure-branch')
    .send({ slug: 'owner/repo', branch: 'main' })
    .expect(200);

  const feature = await request(app)
    .post('/api/v1/sandboxes/ensure-branch')
    .send({ slug: 'owner/repo', branch: 'feature/add-login' })
    .expect(200);

  assert.equal(main.body.slug, 'owner/repo-main-sandbox');
  assert.equal(feature.body.slug, 'owner/repo-feature/add-login-sandbox');
  assert.equal(main.body.port, 9000);
  assert.equal(feature.body.port, 9001);
});

test('caches ensured branch sandboxes', async () => {
  const cache = new Map();
  const app = buildApp({ cache, slugSuffix: '-preview' });

  const first = await request(app)
    .post('/api/v1/sandboxes/ensure-branch')
    .send({ slug: 'owner/repo', branch: 'main' })
    .expect(200);

  cache.set('owner/repo#main', {
    slug: 'cached-branch',
    host: 'cache.local',
    port: 4040,
    token: 'cached-token',
    expiresAt: Date.now() + 10000,
  });

  const second = await request(app)
    .post('/api/v1/sandboxes/ensure-branch')
    .send({ slug: 'owner/repo', branch: 'main' })
    .expect(200);

  assert.equal(first.body.slug, 'owner/repo-main-preview');
  assert.equal(second.body.slug, 'cached-branch');
  assert.equal(second.body.host, 'cache.local');
  assert.equal(second.body.port, 4040);
  assert.equal(second.body.token, 'cached-token');
});
