import express from 'express';
import morgan from 'morgan';

import { SandboxProvider } from './sandboxProvider.js';

export function createApp(options = {}) {
  const {
    slugPrefix = process.env.SANDBOX_SLUG_PREFIX ?? '',
    slugSuffix = process.env.SANDBOX_SLUG_SUFFIX ?? '-sandbox',
    cache = new Map(),
    sandboxProvider,
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

  app.use((err, _req, res, _next) => {
    console.error('Unexpected error handling request', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
