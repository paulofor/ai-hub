import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/server.js';
import { SandboxProvider } from '../src/sandboxProvider.js';

process.env.NODE_ENV = 'test';

const buildApp = (options = {}) => {
  const cache = options.cache ?? new Map();
  const jobRegistry = options.jobRegistry ?? new Map();
  const provider =
    options.provider ??
    new SandboxProvider({
      cache,
      slugSuffix: options.slugSuffix,
      host: 'sandbox.local',
      basePort: 9500,
    });

  return createApp({
    slugSuffix: options.slugSuffix,
    cache,
    sandboxProvider: provider,
    jobRegistry,
  });
};

test('accepts a job request and provisions a sandbox connection', async () => {
  const app = buildApp({ slugSuffix: '-workspace' });
  const payload = {
    jobId: 'job-123',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    task: 'fix failing tests',
    language: 'java',
    testCommand: 'mvn test',
    slug: 'example/repo',
  };

  const response = await request(app).post('/api/v1/jobs').send(payload).expect(201);

  assert.equal(response.body.jobId, payload.jobId);
  assert.equal(response.body.repoUrl, payload.repoUrl);
  assert.equal(response.body.branch, 'main');
  assert.equal(response.body.task, payload.task);
  assert.equal(response.body.status, 'QUEUED');
  assert.equal(response.body.sandbox.slug, 'example/repo-workspace');
  assert.equal(response.body.sandbox.port, 9500);
});

test('reuses existing job idempotently', async () => {
  const jobRegistry = new Map();
  const app = buildApp({ jobRegistry, slugSuffix: '-env' });
  const payload = {
    jobId: 'job-abc',
    repoUrl: 'https://github.com/example/repo.git',
    branch: 'develop',
    task: 'refactor service layer',
  };

  const first = await request(app).post('/api/v1/jobs').send(payload).expect(201);
  const second = await request(app).post('/api/v1/jobs').send(payload).expect(200);

  assert.equal(first.body.jobId, second.body.jobId);
  assert.equal(second.body.sandbox.port, first.body.sandbox.port);
  assert.equal(second.body.status, first.body.status);
  assert.equal(jobRegistry.size, 1);
});

test('rejects invalid job payloads', async () => {
  const app = buildApp();

  await request(app).post('/api/v1/jobs').send({}).expect(400);
  await request(app)
    .post('/api/v1/jobs')
    .send({ jobId: 'x', repoUrl: 'y', branch: 'z', task: '  ' })
    .expect(400);
});
