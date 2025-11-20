import express from 'express';
import morgan from 'morgan';

import { SandboxProvider } from './sandboxProvider.js';

export function createApp(options = {}) {
  const {
    slugPrefix = process.env.SANDBOX_SLUG_PREFIX ?? '',
    slugSuffix = process.env.SANDBOX_SLUG_SUFFIX ?? '-sandbox',
    cache = new Map(),
    sandboxProvider,
    jobRegistry = new Map(),
  } = options;

  const provider =
    sandboxProvider ??
    new SandboxProvider({
      slugPrefix,
      slugSuffix,
      cache,
    });

  const app = express();

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/v1/sandboxes/ensure', (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';

    if (!slug) {
      return res.status(400).json({ error: 'slug is required' });
    }

    const sandbox = provider.ensure({ slug });

    res.json(sandbox);
  });

  app.post('/api/v1/sandboxes/ensure-branch', (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';

    if (!slug || !branch) {
      return res.status(400).json({ error: 'slug and branch are required' });
    }

    const cacheKey = `${slug}#${branch}`;
    const branchSlug = `${slug}-${branch}`;
    const sandbox = provider.ensure({ slug: branchSlug, cacheKey });

    res.json(sandbox);
  });

  app.post('/api/v1/jobs', (req, res) => {
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId.trim() : '';
    const repoUrl = typeof req.body?.repoUrl === 'string' ? req.body.repoUrl.trim() : '';
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
    const task = typeof req.body?.task === 'string' ? req.body.task.trim() : '';
    const language = typeof req.body?.language === 'string' ? req.body.language.trim() : undefined;
    const testCommand = typeof req.body?.testCommand === 'string' ? req.body.testCommand.trim() : undefined;
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';

    if (!jobId || !repoUrl || !branch || !task) {          
      return res.status(400).json({ error: 'jobId, repoUrl, branch and task are required' });
    }

    const existing = jobRegistry.get(jobId);
    if (existing) {
      return res.json(existing);
    }

    const sandbox = provider.ensure({ slug: slug || repoUrl });
    const now = new Date().toISOString();
    const job = {
      jobId,
      repoUrl,
      branch,
      task,
      language,
      testCommand,
      status: 'QUEUED',
      createdAt: now,
      sandbox,
    };

    jobRegistry.set(jobId, job);

    res.status(201).json(job);
  });

  app.use((err, _req, res, _next) => {
    console.error('Unexpected error handling request', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
