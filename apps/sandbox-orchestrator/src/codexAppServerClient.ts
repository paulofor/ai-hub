import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

export type CodexAppServerHealthStatus = 'disabled' | 'starting' | 'ready' | 'degraded' | 'stopped';

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

export interface CodexAppServerClientOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  restartBackoffMs?: number;
  maxRestartAttempts?: number;
  autoRestart?: boolean;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface CodexAppServerHealth {
  status: CodexAppServerHealthStatus;
  ready: boolean;
  restartAttempts: number;
  lastError?: string;
  initializedAt?: string;
}

export class CodexAppServerError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'CodexAppServerError';
  }
}

export class CodexAppServerClient {
  private readonly command: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs: number;
  private readonly restartBackoffMs: number;
  private readonly maxRestartAttempts: number;
  private readonly autoRestart: boolean;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly notifications = new EventEmitter();
  private readonly pending = new Map<number, PendingRequest>();

  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private status: CodexAppServerHealthStatus = 'stopped';
  private startPromise?: Promise<void>;
  private intentionalStop = false;
  private restartAttempts = 0;
  private restartTimer?: NodeJS.Timeout;
  private lastError?: string;
  private initializedAt?: string;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.command = options.command ?? process.env.CODEX_APP_SERVER_COMMAND ?? 'codex';
    this.args = options.args ?? (process.env.CODEX_APP_SERVER_ARGS?.trim().split(/\s+/).filter(Boolean) ?? ['app-server', '--listen', 'stdio://']);
    this.env = { ...process.env, ...options.env };
    this.requestTimeoutMs = options.requestTimeoutMs ?? Number.parseInt(process.env.CODEX_APP_SERVER_REQUEST_TIMEOUT_MS ?? '10000', 10);
    this.restartBackoffMs = options.restartBackoffMs ?? Number.parseInt(process.env.CODEX_APP_SERVER_RESTART_BACKOFF_MS ?? '2000', 10);
    this.maxRestartAttempts = options.maxRestartAttempts ?? Number.parseInt(process.env.CODEX_APP_SERVER_MAX_RESTART_ATTEMPTS ?? '3', 10);
    this.autoRestart = options.autoRestart ?? true;
    this.logger = options.logger ?? console;
  }

  async start(): Promise<void> {
    if (this.isReady()) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.intentionalStop = false;
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.status = 'stopped';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.rejectAllPending(new CodexAppServerError('Codex App Server parado pelo supervisor'));
    const child = this.process;
    this.process = undefined;
    if (!child || child.killed) {
      return;
    }
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
        resolve();
      }, 2000).unref();
    });
  }

  isReady(): boolean {
    return this.status === 'ready' && !!this.process && !this.process.killed;
  }

  health(): CodexAppServerHealth {
    return {
      status: this.status,
      ready: this.isReady(),
      restartAttempts: this.restartAttempts,
      lastError: this.lastError,
      initializedAt: this.initializedAt,
    };
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.isReady()) {
      throw new CodexAppServerError('Codex App Server não está pronto');
    }
    return this.sendRequest<T>(method, params);
  }

  onNotification(method: string, listener: (params: unknown) => void): () => void {
    this.notifications.on(method, listener);
    return () => this.notifications.off(method, listener);
  }

  pendingRequestCountForTests(): number {
    return this.pending.size;
  }

  private async startProcess(): Promise<void> {
    this.status = 'starting';
    this.lastError = undefined;
    this.initializedAt = undefined;
    this.logger.info(`Iniciando Codex App Server via ${this.command} ${this.args.join(' ')}`);

    const child = spawn(this.command, this.args, {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.logger.warn(`Codex App Server stderr: ${this.sanitize(text)}`);
      }
    });
    child.once('error', (err) => {
      this.lastError = err.message;
      this.status = 'degraded';
      this.rejectAllPending(err);
    });
    child.once('exit', (code, signal) => {
      rl.close();
      this.handleExit(code, signal);
    });

    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'ai_hub',
        title: 'AI Hub',
        version: '1.0.0',
      },
    });
    this.sendNotification('initialized', {});
    this.status = 'ready';
    this.restartAttempts = 0;
    this.initializedAt = new Date().toISOString();
    this.logger.info('Codex App Server inicializado com sucesso');
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const child = this.process;
    if (!child || !child.stdin.writable) {
      return Promise.reject(new CodexAppServerError('Codex App Server sem stdin gravável'));
    }

    const message: JsonObject = { method, id };
    if (params !== undefined) {
      message.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new CodexAppServerError(`Timeout em request ${method}`);
        if (method === 'initialize' && this.status === 'starting') {
          this.status = 'degraded';
          this.lastError = error.message;
        }
        reject(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.logger.info(`Codex App Server request method=${method} requestId=${id}`);
      child.stdin.write(`${JSON.stringify(message)}\n`, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const child = this.process;
    if (!child || !child.stdin.writable) {
      throw new CodexAppServerError('Codex App Server sem stdin gravável');
    }
    const message: JsonObject = { method };
    if (params !== undefined) {
      message.params = params;
    }
    this.logger.info(`Codex App Server notification method=${method}`);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let message: JsonObject;
    try {
      message = JSON.parse(trimmed) as JsonObject;
    } catch (err) {
      this.logger.warn(`Codex App Server retornou JSON inválido: ${this.sanitize(trimmed)}`);
      return;
    }

    if (typeof message.id === 'number') {
      this.handleResponse(message.id, message);
      return;
    }

    if (typeof message.method === 'string') {
      this.notifications.emit(message.method, message.params);
    }
  }

  private handleResponse(id: number, message: JsonObject): void {
    const pending = this.pending.get(id);
    if (!pending) {
      this.logger.warn(`Resposta Codex App Server sem request pendente requestId=${id}`);
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);

    if (message.error && typeof message.error === 'object') {
      const error = message.error as { message?: unknown; code?: unknown };
      pending.reject(new CodexAppServerError(String(error.message ?? `Erro em ${pending.method}`), typeof error.code === 'number' ? error.code : undefined));
      return;
    }
    pending.resolve(message.result);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.process = undefined;
    this.rejectAllPending(new CodexAppServerError('Codex App Server encerrou antes de responder requests pendentes'));
    if (this.intentionalStop) {
      this.status = 'stopped';
      return;
    }

    this.status = 'degraded';
    this.lastError = `process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    this.logger.warn(`Codex App Server encerrado inesperadamente: ${this.lastError}`);

    if (!this.autoRestart || this.restartAttempts >= this.maxRestartAttempts) {
      return;
    }

    this.restartAttempts += 1;
    const delay = this.restartBackoffMs * this.restartAttempts;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start().catch((err) => {
        this.status = 'degraded';
        this.lastError = err instanceof Error ? err.message : String(err);
        this.logger.error(`Falha ao reiniciar Codex App Server: ${this.lastError}`);
      });
    }, delay);
  }

  private rejectAllPending(error: unknown): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private sanitize(value: string): string {
    return value
      .replace(/(access_token|refresh_token|id_token|authorization|cookie)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
  }
}
