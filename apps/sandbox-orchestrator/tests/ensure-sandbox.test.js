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
