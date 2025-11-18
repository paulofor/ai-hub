import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/server.js';

process.env.NODE_ENV = 'test';

test('returns a slug with the configured suffix', async () => {
  const app = createApp({ slugSuffix: '-sandbox' });

  const response = await request(app)
    .post('/api/v1/sandboxes/ensure')
    .send({ slug: 'owner/repo' })
    .expect(200);

  assert.equal(response.body.slug, 'owner/repo-sandbox');
});

test('caches provisioned slugs per original slug', async () => {
  const cache = new Map();
  const app = createApp({ cache, slugSuffix: '-env' });

  const first = await request(app)
    .post('/api/v1/sandboxes/ensure')
    .send({ slug: 'owner/repo' })
    .expect(200);

  cache.set('owner/repo', 'custom-sandbox');

  const second = await request(app)
    .post('/api/v1/sandboxes/ensure')
    .send({ slug: 'owner/repo' })
    .expect(200);

  assert.equal(first.body.slug, 'owner/repo-env');
  assert.equal(second.body.slug, 'custom-sandbox');
});

test('rejects invalid payloads', async () => {
  const app = createApp();

  await request(app).post('/api/v1/sandboxes/ensure').send({}).expect(400);
  await request(app).post('/api/v1/sandboxes/ensure').send({ slug: '  ' }).expect(400);
});

test('creates unique slugs per branch', async () => {
  const app = createApp({ slugSuffix: '-sandbox' });

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
});

test('caches ensured branch slugs', async () => {
  const cache = new Map();
  const app = createApp({ cache, slugSuffix: '-preview' });

  const first = await request(app)
    .post('/api/v1/sandboxes/ensure-branch')
    .send({ slug: 'owner/repo', branch: 'main' })
    .expect(200);

  cache.set('owner/repo#main', 'cached-branch');

  const second = await request(app)
    .post('/api/v1/sandboxes/ensure-branch')
    .send({ slug: 'owner/repo', branch: 'main' })
    .expect(200);

  assert.equal(first.body.slug, 'owner/repo-main-preview');
  assert.equal(second.body.slug, 'cached-branch');
});
