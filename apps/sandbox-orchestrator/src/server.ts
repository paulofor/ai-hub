import express, { Request, Response } from 'express';
import morgan from 'morgan';

import { SandboxJobProcessor } from './jobProcessor.js';
import { JobProcessor, SandboxJob } from './types.js';

interface AppOptions {
  jobRegistry?: Map<string, SandboxJob>;
  processor?: JobProcessor;
}

function validateString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createApp(options: AppOptions = {}) {
  const jobRegistry = options.jobRegistry ?? new Map<string, SandboxJob>();
  const processor =
    options.processor ?? new SandboxJobProcessor(process.env.OPENAI_API_KEY, process.env.CIFIX_MODEL);

  const app = express();
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.post('/jobs', async (req: Request, res: Response) => {
    const jobId = validateString(req.body?.jobId);
    const repoUrl = validateString(req.body?.repoUrl);
    const branch = validateString(req.body?.branch);
    const task = validateString(req.body?.task);
    const commitHash = validateString(req.body?.commit);
    const testCommand = validateString(req.body?.testCommand);

    if (!jobId || !repoUrl || !branch || !task) {
      return res.status(400).json({ error: 'jobId, repoUrl, branch e task são obrigatórios' });
    }

    const existing = jobRegistry.get(jobId);
    if (existing) {
      return res.json(existing);
    }

    const now = new Date().toISOString();
    const job: SandboxJob = {
      jobId,
      repoUrl,
      branch,
      task,
      commitHash,
      testCommand,
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
    };

    jobRegistry.set(jobId, job);

    processor
      .process(job)
      .catch((err) => {
        job.status = 'FAILED';
        job.error = err instanceof Error ? err.message : String(err);
        job.updatedAt = new Date().toISOString();
      })
      .finally(() => {
        jobRegistry.set(jobId, job);
      });

    res.status(201).json(job);
  });

  app.get('/jobs/:id', (req: Request, res: Response) => {
    const job = jobRegistry.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }
    res.json(job);
  });

  app.use((err: Error, _req: Request, res: Response, _next: () => void) => {
    console.error('Unexpected error handling request', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
