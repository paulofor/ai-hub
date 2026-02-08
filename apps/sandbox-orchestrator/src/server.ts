import express, { Request, Response } from 'express';
import morgan from 'morgan';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SandboxJobProcessor } from './jobProcessor.js';
import { logWithTimestamp } from './logger.js';
import { JobProcessor, SandboxDatabaseConfig, SandboxJob, SandboxProfile } from './types.js';

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

function normalizeDatabaseConfig(raw: unknown): SandboxDatabaseConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const source = raw as Record<string, unknown>;
  const host = validateString(source.host);
  const database = validateString(source.database ?? (source as any).dbName);
  const user = validateString(source.user ?? (source as any).username ?? (source as any).dbUser);
  const password = typeof source.password === 'string' ? source.password : validateString(source.password);
  const portRaw = typeof source.port === 'number' ? source.port : Number((source as any).port);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.floor(portRaw) : undefined;

  if (!host || !database || !user) {
    return undefined;
  }

  return { host, database, user, password: password ?? undefined, port } satisfies SandboxDatabaseConfig;
}

function redactDatabasePassword(job: SandboxJob): SandboxJob {
  if (!job.database || job.database.password === undefined) {
    return job;
  }
  const { password: _password, ...database } = job.database;
  return { ...job, database } satisfies SandboxJob;
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
  app.use(express.json({ limit: '500kb' }));

  const healthcheckPythonInfo = () => {
    const pythonPath = spawnSync('which', ['python3'], { encoding: 'utf-8' });
    const pipVersion = spawnSync('pip3', ['--version'], { encoding: 'utf-8' });

    const python = pythonPath.status === 0 ? pythonPath.stdout.trim() : undefined;
    const pip = pipVersion.status === 0 ? pipVersion.stdout.trim() : undefined;

    if (python) {
      logWithTimestamp('info', `Sandbox orchestrator healthcheck: python3 disponível em ${python}`);
    } else {
      logWithTimestamp('warn', 'Sandbox orchestrator healthcheck: python3 não encontrado');
    }

    if (pip) {
      logWithTimestamp('info', `Sandbox orchestrator healthcheck: pip3 detectado (${pip})`);
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
    const database = normalizeDatabaseConfig(req.body?.database);
    const profile = normalizeProfile(validateString(req.body?.profile));

    if (!jobId || (!repoUrl && !repoSlug) || !branch || !taskDescription) {
      return res.status(400).json({ error: 'jobId, repoSlug/repoUrl, branch e taskDescription são obrigatórios' });
    }

    const existing = jobRegistry.get(jobId);
    if (existing) {
      logWithTimestamp('info', `Sandbox orchestrator: received duplicate job ${jobId}, returning cached status ${existing.status}`);
      return res.json(redactDatabasePassword(existing));
    }

    const modelLabel = model ? `, modelo ${model}` : '';
    logWithTimestamp(
      'info',
      `Sandbox orchestrator: registrando job ${jobId} para repo ${repoSlug ?? repoUrl} na branch ${branch} (perfil ${profile}${modelLabel})`
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
      database,
      status: 'PENDING',
      logs: [],
      createdAt: now,
      updatedAt: now,
      timeoutCount: 0,
      httpGetCount: 0,
      httpGetSuccessCount: 0,
      dbQueryCount: 0,
      httpRequests: [],
      interactions: [],
      interactionSequence: 0,
      cancelRequested: false,
    };

    jobRegistry.set(jobId, job);

    processor
      .process(job)
      .catch((err) => {
        job.status = job.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
        job.error = err instanceof Error ? err.message : String(err);
        job.updatedAt = new Date().toISOString();
      })
      .finally(() => {
        jobRegistry.set(jobId, job);
      });

    res.status(201).json(redactDatabasePassword(job));
  });

  const recoverOrphanJob = async (jobId: string): Promise<SandboxJob | undefined> => {
    const baseDir = path.resolve(process.env.SANDBOX_WORKDIR ?? os.tmpdir());
    const prefix = `ai-hub-${jobId}-`;

    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
      if (!match) {
        return undefined;
      }

      const sandboxPath = path.join(baseDir, match.name);
      const now = new Date().toISOString();
      const error =
        `job ${jobId} não está mais em memória; o processo do sandbox pode ter reiniciado. ` +
        `Workspace preservado em ${sandboxPath}.`;

      return {
        jobId,
        repoUrl: 'desconhecido',
        branch: 'desconhecida',
        taskDescription: 'workspace órfão',
        status: 'FAILED',
        error,
        sandboxPath,
        logs: [],
        createdAt: now,
        updatedAt: now,
        timeoutCount: 0,
        httpGetCount: 0,
        httpGetSuccessCount: 0,
        dbQueryCount: 0,
        httpRequests: [],
        interactions: [],
        interactionSequence: 0,
        cancelRequested: false,
      } satisfies SandboxJob;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWithTimestamp('warn', `Sandbox orchestrator: falha ao verificar workdir para job ${jobId}: ${message}`);
      return undefined;
    }
  };

  app.get('/jobs/:id', async (req: Request, res: Response) => {
    const jobId = req.params.id;
    const job = jobRegistry.get(jobId);
    if (job) {
      return res.json(redactDatabasePassword(job));
    }

    const recovered = await recoverOrphanJob(jobId);
    if (recovered) {
      jobRegistry.set(jobId, recovered);
      return res.json(redactDatabasePassword(recovered));
    }

    res.status(404).json({ error: 'job not found' });
  });

  app.post('/jobs/:id/cancel', (req: Request, res: Response) => {
    const job = jobRegistry.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return res.status(409).json({ error: `job already finished with status ${job.status}` });
    }

    job.cancelRequested = true;
    const now = new Date().toISOString();
    job.updatedAt = now;

    if (job.status === 'PENDING') {
      job.status = 'CANCELLED';
      job.finishedAt = now;
      job.durationMs = 0;
    }

    jobRegistry.set(job.jobId, job);
    res.json(redactDatabasePassword(job));
  });

  app.use((err: Error, _req: Request, res: Response, _next: () => void) => {
    logWithTimestamp('error', 'Unexpected error handling request', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
