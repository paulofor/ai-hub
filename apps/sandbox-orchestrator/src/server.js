import express from 'express';
import morgan from 'morgan';

export function createApp(options = {}) {
  const {
    slugPrefix = process.env.SANDBOX_SLUG_PREFIX ?? '',
    slugSuffix = process.env.SANDBOX_SLUG_SUFFIX ?? '',
    cache = new Map(),
  } = options;

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

    if (!cache.has(slug)) {
      const ensuredSlug = `${slugPrefix}${slug}${slugSuffix}`;
      cache.set(slug, ensuredSlug);
    }

    res.json({ slug: cache.get(slug) });
  });

  app.use((err, _req, res, _next) => {
    console.error('Unexpected error handling request', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
