import express, { Request, Response } from 'express';
import morgan from 'morgan';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexAppServerClient } from './codexAppServerClient.js';
import { cancelCodexLogin, logoutCodexAccount, readCodexAccount, startCodexLogin } from './codexAppServerAuth.js';
import { SandboxJobProcessor } from './jobProcessor.js';
import { JobProcessor, SandboxDatabaseConfig, SandboxImageAttachment, SandboxJob, SandboxProfile } from './types.js';

interface AppOptions {
  jobRegistry?: Map<string, SandboxJob>;
  processor?: JobProcessor;
  codexAppServerClient?: CodexAppServerClient;
}

function validateString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}


function normalizeImageAttachments(value: unknown): SandboxImageAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const attachments = value
    .map((item): SandboxImageAttachment | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const dataUrl = validateString(record.dataUrl);
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        return null;
      }
      return {
        name: validateString(record.name),
        mimeType: validateString(record.mimeType),
        size: typeof record.size === 'number' ? record.size : undefined,
        dataUrl,
      };
    })
    .filter((item): item is SandboxImageAttachment => item !== null);
  return attachments.length > 0 ? attachments.slice(0, 5) : undefined;
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

function sanitizeJobForResponse(job: SandboxJob): SandboxJob {
  const sanitized: SandboxJob = {
    ...job,
    accessToken: undefined,
    githubToken: undefined,
    callbackSecret: undefined,
    interactionCount: Math.max(
      ...[
        job.interactionCount,
        Number.isFinite(job.interactionSequence) ? job.interactionSequence : undefined,
        Array.isArray(job.interactions) ? job.interactions.length : undefined,
      ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      0,
    ),
  };
  if (job.database) {
    const { password: _password, ...database } = job.database;
    sanitized.database = database;
  }
  return sanitized;
}

export function createApp(options: AppOptions = {}) {
  const jobRegistry = options.jobRegistry ?? new Map<string, SandboxJob>();
  const codexAppServerClient = options.codexAppServerClient;
  const processor =
    options.processor ?? new SandboxJobProcessor(process.env.OPENAI_API_KEY, process.env.CIFIX_MODEL, undefined, globalThis.fetch, codexAppServerClient);

  const normalizeProfile = (value?: string): SandboxProfile => {
    if (!value) {
      return 'STANDARD';
    }
    const normalized = value.trim().toUpperCase().replace('-', '_');
    if (normalized === 'ECONOMY') {
      return 'ECONOMY';
    }
    if (normalized === 'SMART_ECONOMY') {
      return 'SMART_ECONOMY';
    }
    if (normalized === 'ECO_1') {
      return 'ECO_1';
    }
    if (normalized === 'ECO_2') {
      return 'ECO_2';
    }
    if (normalized === 'ECO_3') {
      return 'ECO_3';
    }
    if (normalized === 'CHATGPT_CODEX' || normalized === 'CODEX_UI') {
      return 'CHATGPT_CODEX';
    }
    if (normalized === 'CHATGPT_CODEX_MKT' || normalized === 'CODEX_UI_MKT') {
      return 'CHATGPT_CODEX_MKT';
    }
    return 'STANDARD';
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
    const codexAppServer = codexAppServerClient?.health() ?? {
      status: 'disabled',
      ready: false,
      restartAttempts: 0,
    };
    res.json({ status: codexAppServer.status === 'degraded' ? 'degraded' : 'ok', python: healthcheckPythonInfo(), codexAppServer });
  });

  app.get('/codex-app-server/account/read', async (_req: Request, res: Response) => {
    if (!codexAppServerClient) {
      return res.status(503).json({
        connected: false,
        status: 'unavailable',
        executable: false,
        blockReason: 'CODEX_APP_SERVER_DISABLED',
      });
    }
    const state = await readCodexAccount(codexAppServerClient);
    const httpStatus = state.status === 'unavailable' ? 503 : 200;
    return res.status(httpStatus).json(state);
  });


  app.post('/codex-app-server/account/login/start', async (req: Request, res: Response) => {
    if (!codexAppServerClient) {
      return res.status(503).json({ status: 'unavailable', blockReason: 'CODEX_APP_SERVER_DISABLED' });
    }
    try {
      const requestedType = validateString(req.body?.type) ?? 'chatgptDeviceCode';
      const state = await startCodexLogin(codexAppServerClient, requestedType);
      return res.status(202).json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CODEX_LOGIN_FAILED';
      const status = message === 'CODEX_APP_SERVER_UNAVAILABLE' ? 503 : 502;
      return res.status(status).json({ status: 'failed', blockReason: message });
    }
  });

  app.post('/codex-app-server/account/login/cancel', async (req: Request, res: Response) => {
    if (!codexAppServerClient) {
      return res.status(503).json({ status: 'unavailable', blockReason: 'CODEX_APP_SERVER_DISABLED' });
    }
    const loginId = validateString(req.body?.loginId);
    if (!loginId) {
      return res.status(400).json({ status: 'failed', blockReason: 'CODEX_LOGIN_ID_REQUIRED' });
    }
    try {
      await cancelCodexLogin(codexAppServerClient, loginId);
      return res.json({ status: 'cancelled', loginId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CODEX_LOGIN_FAILED';
      const status = message === 'CODEX_APP_SERVER_UNAVAILABLE' ? 503 : 502;
      return res.status(status).json({ status: 'failed', blockReason: message });
    }
  });

  app.post('/codex-app-server/account/logout', async (_req: Request, res: Response) => {
    if (!codexAppServerClient) {
      return res.status(503).json({ status: 'unavailable', blockReason: 'CODEX_APP_SERVER_DISABLED' });
    }
    try {
      const state = await logoutCodexAccount(codexAppServerClient);
      return res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CODEX_APP_SERVER_UNAVAILABLE';
      const status = message === 'CODEX_APP_SERVER_UNAVAILABLE' ? 503 : 502;
      return res.status(status).json({ status: 'failed', blockReason: message });
    }
  });

  app.post('/jobs', async (req: Request, res: Response) => {
    const jobId = validateString(req.body?.jobId);
    const repoUrl = validateString(req.body?.repoUrl);
    const repoSlug = validateString(req.body?.repoSlug);
    const branch = validateString(req.body?.branch);
    const workBranch = validateString(req.body?.workBranch);
    const taskDescription = validateString(req.body?.taskDescription ?? req.body?.task);
    const commitHash = validateString(req.body?.commit);
    const testCommand = validateString(req.body?.testCommand);
    const model = validateString(req.body?.model);
    const accessToken = validateString(req.body?.accessToken);
    const githubToken = validateString(req.body?.githubToken);
    const createPullRequest = validateBoolean(req.body?.createPullRequest);
    const database = normalizeDatabaseConfig(req.body?.database);
    const profile = normalizeProfile(validateString(req.body?.profile));
    const callbackUrl = validateString(req.body?.callbackUrl);
    const callbackSecret = validateString(req.body?.callbackSecret);
    const imageAttachments = normalizeImageAttachments(req.body?.imageAttachments);

    if (!jobId || (!repoUrl && !repoSlug) || !branch || !taskDescription) {
      return res.status(400).json({ error: 'jobId, repoSlug/repoUrl, branch e taskDescription são obrigatórios' });
    }

    const existing = jobRegistry.get(jobId);
    if (existing) {
      console.log(`Sandbox orchestrator: received duplicate job ${jobId}, returning cached status ${existing.status}`);
      return res.json(sanitizeJobForResponse(existing));
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
      workBranch,
      taskDescription,
      imageAttachments,
      commitHash,
      testCommand,
      profile,
      model: model ?? undefined,
      accessToken: (profile === 'CHATGPT_CODEX' || profile === 'CHATGPT_CODEX_MKT') ? undefined : accessToken ?? undefined,
      githubToken: githubToken ?? undefined,
      createPullRequest,
      database,
      callbackUrl: callbackUrl ?? undefined,
      callbackSecret: callbackSecret ?? undefined,
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

    res.status(201).json(sanitizeJobForResponse(job));
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
      console.warn(`Sandbox orchestrator: falha ao verificar workdir para job ${jobId}: ${message}`);
      return undefined;
    }
  };

  app.get('/jobs/:id', async (req: Request, res: Response) => {
    const jobId = req.params.id;
    const job = jobRegistry.get(jobId);
    if (job) {
      return res.json(sanitizeJobForResponse(job));
    }

    const recovered = await recoverOrphanJob(jobId);
    if (recovered) {
      jobRegistry.set(jobId, recovered);
      return res.json(sanitizeJobForResponse(recovered));
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
    res.json(sanitizeJobForResponse(job));
  });

  app.use((err: Error, _req: Request, res: Response, _next: () => void) => {
    console.error('Unexpected error handling request', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
