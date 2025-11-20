import crypto from 'node:crypto';

export class SandboxProvider {
  constructor(options = {}) {
    this.slugPrefix = options.slugPrefix ?? process.env.SANDBOX_SLUG_PREFIX ?? '';
    this.slugSuffix = options.slugSuffix ?? process.env.SANDBOX_SLUG_SUFFIX ?? '-sandbox';
    this.cache = options.cache ?? new Map();
    this.image = options.image ?? process.env.SANDBOX_IMAGE ?? 'ghcr.io/ai-hub/sandbox:latest';
    this.ttlSeconds = Number.parseInt(
      options.ttlSeconds ?? process.env.SANDBOX_TTL_SECONDS ?? '3600',
      10,
    );
    this.cpuLimit = options.cpuLimit ?? process.env.SANDBOX_CPU_LIMIT ?? '1';
    this.memoryLimit = options.memoryLimit ?? process.env.SANDBOX_MEMORY_LIMIT ?? '512m';
    this.host = options.host ?? process.env.SANDBOX_HOST ?? '127.0.0.1';
    this.basePort = Number.parseInt(options.basePort ?? process.env.SANDBOX_BASE_PORT ?? '3000', 10);
  }

  ensure({ slug, cacheKey }) {
    const key = cacheKey ?? slug;
    const now = Date.now();
    const current = this.cache.get(key);

    if (current?.expiresAt && current.expiresAt > now) {
      return current;
    }

    const ensuredSlug = this.applySlugFormatting(slug);
    const connection = this.provisionConnection(ensuredSlug);

    this.cache.set(key, connection);

    return connection;
  }

  applySlugFormatting(slug) {
    return `${this.slugPrefix}${slug}${this.slugSuffix}`;
  }

  provisionConnection(slug) {
    const expiresAt = Date.now() + this.ttlSeconds * 1000;

    return {
      slug,
      host: this.host,
      port: this.basePort + this.cache.size,
      token: crypto.randomBytes(24).toString('hex'),
      ttlSeconds: this.ttlSeconds,
      cpuLimit: this.cpuLimit,
      memoryLimit: this.memoryLimit,
      image: this.image,
      expiresAt,
    };
  }
}
