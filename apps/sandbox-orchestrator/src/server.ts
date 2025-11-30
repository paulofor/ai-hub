import express, { Request, Response } from 'express';
import morgan from 'morgan';
import { spawnSync } from 'node:child_process';

import { SandboxJobProcessor } from './jobProcessor.js';
import { JobProcessor, SandboxJob, SandboxProfile } from './types.js';

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

  const normalizeProfile = (value?: string): SandboxProfile => {
    if (!value) {
      return 'STANDARD';
    }
    const normalized = value.trim().toUpperCase();
    return normalized === 'ECONOMY' ? 'ECONOMY' : 'STANDARD';
  };

  const app = express();
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }
  app.use(express.json());

  const healthcheckPythonInfo = () => {
    const pythonPath = spawnSync('which', ['python3'], { encoding: 'utf-8' });
    const pipVersion = spawnSync('pip3', ['--version'], { encoding: 'utf-8' });

    const python = pythonPath.status === 0 ? pythonPath.stdout.trim() : undefined;
    const pip = pipVersion.status === 0 ? pipVersion.stdout.trim() : undefined;

    if (python) {
      console.log(`Sandbox orchestrator healthcheck: python3 disponível em ${python}`);
    } else {
      console.warn('Sandbox orchestrator healthcheck: python3 não encontrado');
    }

    if (pip) {
      console.log(`Sandbox orchestrator healthcheck: pip3 detectado (${pip})`);
    }

    return { python, pip };
  };

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', python: healthcheckPythonInfo() });
  });

  app.post('/jobs', async (req: Request, res: Response) => {
    const jobId = validateString(req.body?.jobId);
    const repoUrl = validateString(req.body?.repoUrl);
    const repoSlug = validateString(req.body?.repoSlug);
    const branch = validateString(req.body?.branch);
    const taskDescription = validateString(req.body?.taskDescription ?? req.body?.task);
    const commitHash = validateString(req.body?.commit);
    const testCommand = validateString(req.body?.testCommand);
    const model = validateString(req.body?.model);
    const profile = normalizeProfile(validateString(req.body?.profile));

    if (!jobId || (!repoUrl && !repoSlug) || !branch || !taskDescription) {
      return res.status(400).json({ error: 'jobId, repoSlug/repoUrl, branch e taskDescription são obrigatórios' });
    }

    const existing = jobRegistry.get(jobId);
    if (existing) {
      console.log(`Sandbox orchestrator: received duplicate job ${jobId}, returning cached status ${existing.status}`);
      return res.json(existing);
    }

    const modelLabel = model ? `, modelo ${model}` : '';
    console.log(
      `Sandbox orchestrator: registrando job ${jobId} para repo ${repoSlug ?? repoUrl} na branch ${branch} (perfil ${profile}${modelLabel})`,
    );

    const now = new Date().toISOString();
    const job: SandboxJob = {
      jobId,
      repoSlug: repoSlug,
      repoUrl: repoUrl ?? `https://github.com/${repoSlug}.git`,
      branch,
      taskDescription,
      commitHash,
      testCommand,
      profile,
      model: model ?? undefined,
      status: 'PENDING',
      logs: [],
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
