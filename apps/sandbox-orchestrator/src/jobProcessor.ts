import { exec as execCallback, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import {
  ResponseFunctionToolCallItem,
  ResponseFunctionToolCallOutputItem,
  ResponseItem,
  ResponseOutputMessage,
  ResponseOutputText,
} from 'openai/resources/responses/responses.js';

import { buildAuthRepoUrl, extractTokenFromRepoUrl, redactUrlCredentials } from './git.js';
import { JobProcessor, SandboxJob } from './types.js';

const exec = promisify(execCallback);

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export class SandboxJobProcessor implements JobProcessor {
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly fetchImpl?: (input: string | URL, init?: any) => Promise<any>;
  private readonly githubApiBase: string;
  private readonly maxTaskDescriptionChars: number;
  private readonly toolOutputStringLimit: number;
  private readonly toolOutputSerializedLimit: number;

  constructor(
    apiKey?: string,
    model = 'gpt-5-codex',
    openaiClient?: OpenAI,
    fetchImpl: (input: string | URL, init?: any) => Promise<any> = globalThis.fetch,
  ) {
    this.model = model;
    if (openaiClient) {
      this.openai = openaiClient;
    } else if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
    this.fetchImpl = fetchImpl;
    this.githubApiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';
    this.maxTaskDescriptionChars = this.parsePositiveInteger(process.env.TASK_DESCRIPTION_MAX_CHARS, 12_000);
    this.toolOutputStringLimit = this.parsePositiveInteger(process.env.TOOL_OUTPUT_STRING_LIMIT, 12_000);
    this.toolOutputSerializedLimit = this.parsePositiveInteger(process.env.TOOL_OUTPUT_SERIALIZED_LIMIT, 60_000);
  }

  async process(job: SandboxJob): Promise<void> {
    job.status = 'RUNNING';
    job.updatedAt = new Date().toISOString();
    const workspace = await this.prepareWorkspace(job);
    const repoPath = path.join(workspace, 'repo');
    job.sandboxPath = workspace;
    this.log(job, `workspace criado em ${workspace}`);

    try {
      const githubAuth = this.resolveGithubAuth(job);
      if (githubAuth.token) {
        this.log(
          job,
          `token GitHub obtido de ${githubAuth.source} será usado para clone, push e criação de PR`,
        );
      } else {
        this.log(job, 'nenhum token GitHub configurado; operações autenticadas podem falhar');
      }

      const cloneUrl = buildAuthRepoUrl(job.repoUrl, githubAuth.token, githubAuth.username);
      this.log(job, `clonando repositório ${redactUrlCredentials(cloneUrl)} (branch ${job.branch})`);
      await this.cloneRepository(job, repoPath, cloneUrl);
      const baseCommit = await this.getHeadCommit(repoPath);
      if (!this.openai) {
        throw new Error('OPENAI_API_KEY não configurada no sandbox orchestrator');
      }

      this.log(job, 'iniciando interação com o modelo do sandbox');
      const summary = await this.runCodexLoop(job, repoPath);
      job.summary = summary;
      job.changedFiles = await this.collectChangedFiles(repoPath, baseCommit);
      job.patch = await this.generatePatch(repoPath, baseCommit);
      await this.maybeCreatePullRequest(job, repoPath, githubAuth, baseCommit, job.patch);
      this.log(job, 'job concluído com sucesso, coletando patch e arquivos alterados');
      job.status = 'COMPLETED';
    } catch (error) {
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message : String(error);
      this.log(job, `falha ao processar job: ${job.error}`);
    } finally {
      job.updatedAt = new Date().toISOString();
      this.log(job, `limpando workspace ${workspace}`);
      await this.cleanup(workspace);
    }
  }

  private async prepareWorkspace(job: SandboxJob): Promise<string> {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), `ai-hub-${job.jobId}-`));
    return base;
  }

  private resolveGithubAuth(job: SandboxJob): { token?: string; username: string; source: string } {
    const username = process.env.GITHUB_CLONE_USERNAME ?? 'x-access-token';
    const candidates: Array<{ token?: string; source: string }> = [
      { token: process.env.GITHUB_CLONE_TOKEN, source: 'GITHUB_CLONE_TOKEN' },
      { token: process.env.GITHUB_TOKEN, source: 'GITHUB_TOKEN' },
      { token: process.env.GITHUB_PR_TOKEN, source: 'GITHUB_PR_TOKEN' },
      { token: extractTokenFromRepoUrl(job.repoUrl), source: 'repoUrl' },
    ];

    const selected = candidates.find((candidate) => candidate.token);
    return { token: selected?.token, username, source: selected?.source ?? 'nenhum' };
  }

  private async cleanup(workspace: string): Promise<void> {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch (err) {
      // noop
    }
  }

  private async cloneRepository(job: SandboxJob, repoPath: string, cloneUrl: string): Promise<void> {
    await exec(`git clone --branch ${job.branch} --depth 1 ${cloneUrl} ${repoPath}`);
    if (job.commitHash) {
      this.log(job, `checando commit ${job.commitHash}`);
      await exec(`git checkout ${job.commitHash}`, { cwd: repoPath });
    }
  }

  private buildTools(repoPath: string) {
    return [
      {
        type: 'function' as const,
        name: 'run_shell',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string', description: 'Diretório relativo ao repo' },
          },
          required: ['command', 'cwd'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Executa um comando de shell dentro do sandbox clonado',
      },
      {
        type: 'function' as const,
        name: 'read_file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Lê um arquivo do repositório clonado',
      },
      {
        type: 'function' as const,
        name: 'write_file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Escreve um arquivo dentro do repositório clonado',
      },
    ];
  }

  private async runCodexLoop(job: SandboxJob, repoPath: string): Promise<string> {
    job.taskDescription = this.sanitizeTaskDescription(job.taskDescription, job);

    const tools = this.buildTools(repoPath);
    const messages: ResponseItem[] = [
      {
        type: 'message',
        id: this.sanitizeId('msg_system'),
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Você está operando em um sandbox isolado em ${repoPath}. Use as tools para ler, alterar arquivos e executar comandos. Test command sugerido: ${
              job.testCommand ?? 'n/d'
            }. Sempre trabalhe somente dentro do diretório do repositório. Prefira usar o comando rg para buscas recursivas em vez de grep -R, que é mais lento.`,
          },
        ],
      },
      {
        type: 'message',
        id: this.sanitizeId('msg_user'),
        role: 'user',
        content: [{ type: 'input_text', text: job.taskDescription }],
      },
    ];

    let summary = '';
    this.log(job, 'loop do modelo iniciado; aguardando chamadas de ferramenta');

    while (true) {
      this.log(job, `enviando mensagens para o modelo (mensagens=${messages.length}, tools=${tools.length})`);
      const response = await this.openai!.responses.create({
        model: this.model,
        input: messages,
        tools,
      });
      this.log(
        job,
        `resposta do modelo recebida (responseId=${response.id ?? 'n/d'}, output_items=${(response.output ?? []).length})`,
      );

      this.addUsageMetrics(job, (response as any).usage);

      const output = response.output ?? [];
      const normalizedOutput: ResponseItem[] = output.map((item, index) => {
        if (item.type === 'function_call') {
          const callId = this.extractCallId(item, index);
          const messageId = this.sanitizeId(item.id ?? callId);
          return { ...item, id: messageId, call_id: callId } as ResponseItem;
        }
        return item as ResponseItem;
      });
      const assistantMessage = normalizedOutput.find((item) => item.type === 'message') as ResponseOutputMessage | undefined;
      const toolCalls = normalizedOutput.filter((item) => item.type === 'function_call') as ResponseFunctionToolCallItem[];

      const toolCallDetails =
        toolCalls
          .map((call, idx) => {
            const callId = call.call_id ?? this.extractCallId(call, idx);
            return `${call.name ?? 'sem_nome'}(callId=${callId}, id=${call.id ?? 'n/d'})`;
          })
          .join(', ') || 'nenhum';
      const assistantTextPreview = this.truncate(this.extractOutputText(assistantMessage?.content) ?? '', 240);
      this.log(
        job,
        `modelo retornou ${toolCalls.length} chamadas de ferramenta e mensagem=${Boolean(
          assistantMessage,
        )} (toolCalls=[${toolCallDetails}], textPreview="${assistantTextPreview}")`,
      );

      const text = this.extractOutputText(assistantMessage?.content);
      if (toolCalls.length === 0) {
        summary = text ?? summary;
        if (assistantMessage) {
          messages.push(assistantMessage);
        }
        this.log(job, `resumo final do modelo: "${this.truncate(summary, 240)}"`);
        this.log(job, 'modelo concluiu sem novas tool calls');
        return summary;
      }

      messages.push(...normalizedOutput);

      const toolMessages: ResponseFunctionToolCallOutputItem[] = [];
      for (const [index, call] of toolCalls.entries()) {
        const parsedArgs = this.parseArguments(call.arguments);
        const callId = call.call_id ?? this.extractCallId(call, index);
        const outputId = this.normalizeFunctionCallOutputId(callId, `call_${index}`);
        const toolCall: ToolCall = {
          id: callId,
          name: call.name ?? '',
          arguments: parsedArgs ?? {},
        };
        this.log(
          job,
          `executando tool ${toolCall.name} (callId=${callId}, args=${JSON.stringify(toolCall.arguments)})`,
        );
        try {
          const result = await this.dispatchTool(toolCall, repoPath, job);
          this.logJson(job, `resultado da tool ${toolCall.name} (callId=${callId})`, result);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: this.prepareToolOutput(result, job),
            type: 'function_call_output',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(job, `erro ao executar tool ${toolCall.name}: ${message}`);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: this.prepareToolOutput({ error: message }, job),
            type: 'function_call_output',
          });
        }
      }

      messages.push(...toolMessages);
    }
  }

  private extractOutputText(content: ResponseOutputMessage['content'] | undefined): string | undefined {
    if (!Array.isArray(content)) {
      return undefined;
    }
    const texts = content
      .filter((item) => item.type === 'output_text')
      .map((item) => (item as ResponseOutputText).text.trim())
      .filter((text) => text.length > 0);

    if (texts.length === 0) {
      return undefined;
    }
    return texts.join('\n').trim();
  }

  private addUsageMetrics(job: SandboxJob, usage: unknown): void {
    if (!usage || typeof usage !== 'object') {
      return;
    }

    const source = usage as Record<string, unknown>;
    const promptTokens = this.readNumberField(source, ['prompt_tokens', 'input_tokens', 'promptTokens']);
    const completionTokens = this.readNumberField(source, [
      'completion_tokens',
      'output_tokens',
      'completionTokens',
    ]);
    const totalTokens =
      this.readNumberField(source, ['total_tokens', 'totalTokens']) ??
      (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
    const cost = this.readNumberField(source, ['total_cost', 'cost']);

    if (promptTokens !== undefined) {
      job.promptTokens = (job.promptTokens ?? 0) + promptTokens;
    }
    if (completionTokens !== undefined) {
      job.completionTokens = (job.completionTokens ?? 0) + completionTokens;
    }
    if (totalTokens !== undefined) {
      job.totalTokens = (job.totalTokens ?? 0) + totalTokens;
    }
    if (cost !== undefined) {
      job.cost = (job.cost ?? 0) + cost;
    }
  }

  private readNumberField(source: Record<string, unknown>, candidates: string[]): number | undefined {
    for (const key of candidates) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private parseArguments(raw: unknown): Record<string, unknown> | undefined {
    if (!raw) {
      return undefined;
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (err) {
        return undefined;
      }
    }
    if (typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    return undefined;
  }

  private async dispatchTool(call: ToolCall, repoPath: string, job: SandboxJob): Promise<unknown> {
    switch (call.name) {
      case 'run_shell':
        return this.handleRunShell(call.arguments, repoPath, job);
      case 'read_file':
        return this.handleReadFile(call.arguments, repoPath);
      case 'write_file':
        return this.handleWriteFile(call.arguments, repoPath, job);
      default:
        return { error: `Ferramenta desconhecida: ${call.name}` };
    }
  }

  private resolvePath(repoPath: string, requested: string | undefined, job?: SandboxJob): string {
    if (!requested) {
      throw new Error('path ausente');
    }
    const sanitized = this.sanitizeRequestedPath(requested);
    if (!sanitized) {
      throw new Error('path ausente');
    }
    if (sanitized !== requested && job) {
      this.log(job, `normalizando caminho solicitado de "${requested}" para "${sanitized}"`);
    }
    const absolute = path.resolve(repoPath, sanitized);
    if (!absolute.startsWith(repoPath)) {
      throw new Error('Acesso a caminho fora do sandbox bloqueado');
    }
    return absolute;
  }

  private normalizeRepoPath(
    repoPath: string,
    requested: string | undefined,
  ): { absolute: string; relative: string } {
    const absolute = this.resolvePath(repoPath, requested);
    const relative = path.relative(repoPath, absolute) || path.basename(absolute);
    return { absolute, relative };
  }

  private async handleRunShell(args: Record<string, unknown>, repoPath: string, job: SandboxJob) {
    let command = Array.isArray(args.command) ? (args.command as string[]) : undefined;
    if (!command || command.length === 0) {
      throw new Error('command é obrigatório para run_shell');
    }
    const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
    const cwd = cwdArg ? this.resolvePath(repoPath, cwdArg, job) : repoPath;
    await this.assertDirectoryExists(cwd);

    command = command.map((part) => part.trim());
    const isRecursiveGrep = command[0] === 'grep' && command[1] === '-R';
    if (isRecursiveGrep && command.length <= 2) {
      const message = 'grep -R detectado. Use rg <padrao> <caminho> para buscas recursivas no sandbox.';
      this.log(job, message);
      throw new Error(message);
    }

    if (isRecursiveGrep) {
      const rgCommand = ['rg', ...command.slice(2)];
      this.log(
        job,
        `comando grep -R detectado; substituindo por rg para busca recursiva: ${command.join(' ')} -> ${rgCommand.join(
          ' ',
        )}`,
      );
      command = rgCommand;
    }

    const joined = command.join(' ');
    const timeoutEnv = Number(process.env.RUN_SHELL_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 600_000;
    const maxBufferEnv = Number(process.env.RUN_SHELL_MAX_BUFFER_BYTES);
    const maxBuffer = Number.isFinite(maxBufferEnv) && maxBufferEnv > 0 ? maxBufferEnv : 5 * 1024 * 1024;

    this.log(
      job,
      `run_shell: ${joined} (cwd=${cwd}, timeoutMs=${timeoutMs}, maxBufferBytes=${maxBuffer})`,
    );

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const child = spawn(command[0], command.slice(1), { cwd });

    const appendWithLimit = (current: string, chunk: string): { value: string; truncated: boolean } => {
      if (current.length >= maxBuffer) {
        return { value: current, truncated: true };
      }
      const remaining = maxBuffer - current.length;
      if (chunk.length <= remaining) {
        return { value: current + chunk, truncated: false };
      }
      return { value: current + chunk.slice(0, remaining), truncated: true };
    };

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const result = appendWithLimit(stdout, chunk);
      stdout = result.value;
      stdoutTruncated = stdoutTruncated || result.truncated;
      this.log(job, `run_shell stdout: ${this.truncate(chunk, 500)}`);
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const result = appendWithLimit(stderr, chunk);
      stderr = result.value;
      stderrTruncated = stderrTruncated || result.truncated;
      this.log(job, `run_shell stderr: ${this.truncate(chunk, 500)}`);
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      this.log(job, `run_shell atingiu timeout de ${timeoutMs}ms; finalizando processo`);
      child.kill('SIGKILL');
    }, timeoutMs);

    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        resolve({ code, signal });
      });
    });

    if (stdoutTruncated || stderrTruncated) {
      this.log(job, 'run_shell output truncado para respeitar maxBuffer');
    }
    this.log(
      job,
      `run_shell finalizado (code=${exitResult.code}, signal=${exitResult.signal}, timedOut=${timedOut})`,
    );

    return {
      stdout,
      stderr,
      exitCode: exitResult.code,
      signal: exitResult.signal,
      timedOut,
      stdoutTruncated,
      stderrTruncated,
    };
  }

  private async handleReadFile(args: Record<string, unknown>, repoPath: string) {
    const { absolute, relative } = this.normalizeRepoPath(
      repoPath,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const content = await fs.readFile(absolute, 'utf8');
    return { path: relative, content };
  }

  private async handleWriteFile(args: Record<string, unknown>, repoPath: string, job: SandboxJob) {
    const { absolute, relative } = this.normalizeRepoPath(
      repoPath,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const content = typeof args.content === 'string' ? args.content : '';
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
    this.log(job, `write_file: ${absolute}`);
    return { status: 'ok', path: relative, content };
  }

  private async collectChangedFiles(repoPath: string, baseCommit?: string): Promise<string[]> {
    if (!(await this.isGitRepository(repoPath))) {
      return [];
    }
    const { stdout } = await exec(`git diff --name-only ${baseCommit ?? 'HEAD'}`, { cwd: repoPath });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private async generatePatch(repoPath: string, baseCommit?: string): Promise<string> {
    if (!(await this.isGitRepository(repoPath))) {
      return '';
    }
    const { stdout } = await exec(`git diff ${baseCommit ?? 'HEAD'}`, { cwd: repoPath });
    return stdout;
  }

  private async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      await fs.stat(path.join(repoPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private resolveRepoSlug(job: SandboxJob): string | undefined {
    if (job.repoSlug) {
      return job.repoSlug;
    }

    try {
      const parsed = new URL(job.repoUrl);
      if (parsed.hostname.toLowerCase() !== 'github.com') {
        return undefined;
      }
      const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async getHeadCommit(repoPath: string): Promise<string | undefined> {
    if (!(await this.isGitRepository(repoPath))) {
      return undefined;
    }
    try {
      const { stdout } = await exec('git rev-parse HEAD', { cwd: repoPath });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async maybeCreatePullRequest(
    job: SandboxJob,
    repoPath: string,
    githubAuth: { token?: string; username: string; source: string },
    baseCommit?: string,
    diffPatch?: string,
  ): Promise<void> {
    const token = githubAuth.token;
    if (!token) {
      this.log(job, 'nenhum token GitHub disponível; ignorando criação de PR');
      return;
    }

    const repoSlug = this.resolveRepoSlug(job);
    if (!repoSlug) {
      this.log(job, 'repoSlug ausente e repoUrl não é github.com; não é possível criar PR');
      return;
    }

    if (!this.fetchImpl) {
      this.log(job, 'fetch API indisponível; não é possível criar PR');
      return;
    }

    if (!(await this.isGitRepository(repoPath))) {
      this.log(job, 'repositório git ausente, não é possível criar PR');
      return;
    }

    const diff = diffPatch ?? (await this.generatePatch(repoPath, baseCommit));
    if (!diff.trim()) {
      this.log(job, 'nenhuma alteração detectada; PR não será criado');
      return;
    }

    const branchName = `ai-hub/cifix-${job.jobId}`;
    try {
      await exec('git config user.email "ai-hub-bot@example.com"', { cwd: repoPath });
      await exec('git config user.name "AI Hub Bot"', { cwd: repoPath });
      await exec(`git checkout -B ${branchName}`, { cwd: repoPath });
      await exec('git add -A', { cwd: repoPath });
      await exec('git commit -m "AI Hub automated fix"', { cwd: repoPath });

      const authenticatedRemote = buildAuthRepoUrl(
        job.repoUrl,
        token,
        githubAuth.username,
      );
      await exec(`git remote set-url origin ${authenticatedRemote}`, { cwd: repoPath });
      try {
        await exec(`git push origin ${branchName}`, { cwd: repoPath });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = this.permissionHintFromMessage(message);
        throw new Error(
          `Falha ao fazer push para criar PR: ${message}${hint ? ` (${hint})` : ''}`,
        );
      }

      const prTitle = this.buildPrTitle(job.summary);
      const prBody = this.buildPrBody(job.summary, job.taskDescription);
      const response = await this.fetchImpl(`${this.githubApiBase}/repos/${repoSlug}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({
          title: prTitle,
          head: branchName,
          base: job.branch,
          body: prBody,
        }),
      });

      if (!response.ok) {
        const message = (await response.text()) || 'erro desconhecido da API do GitHub';
        const permissionHint =
          response.status === 401 || response.status === 403
            ? 'token pode estar sem permissão de pull request ou push'
            : undefined;
        throw new Error(
          `Falha ao criar PR: ${response.status} ${message}${
            permissionHint ? ` (${permissionHint})` : ''
          }`,
        );
      }

      const pr = await response.json();
      if (pr?.html_url) {
        job.pullRequestUrl = pr.html_url;
        this.log(job, `pull request criado em ${job.pullRequestUrl}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(job, `falha ao criar pull request: ${message}`);
    }
  }

  private permissionHintFromMessage(message: string): string | undefined {
    const normalized = message.toLowerCase();
    if (normalized.includes('permission denied') || normalized.includes('authentication failed')) {
      return 'verifique se o token tem escopos de push e pull_request';
    }
    return undefined;
  }

  private log(job: SandboxJob, message: string) {
    const entry = `[${new Date().toISOString()}] ${message}`;
    job.logs.push(entry);
    console.info(`Sandbox job ${job.jobId}: ${message}`);
  }

  private sanitizeRequestedPath(requested: string | undefined): string | undefined {
    if (!requested) {
      return undefined;
    }
    const trimmed = requested.trim();
    const withoutQuotes = trimmed.replace(/^['"`]+|['"`]+$/g, '');
    const withoutTrailingBraces = withoutQuotes.replace(/[}\]]+$/g, '');
    const sanitized = withoutTrailingBraces.trim();
    return sanitized.length > 0 ? sanitized : undefined;
  }

  private async assertDirectoryExists(cwd: string): Promise<void> {
    try {
      const stats = await fs.stat(cwd);
      if (!stats.isDirectory()) {
        throw new Error(`cwd não é um diretório: ${cwd}`);
      }
    } catch (err) {
      throw new Error(`cwd não encontrado: ${cwd}`);
    }
  }

  private extractCallId(item: { id?: string; call_id?: string }, index: number): string {
    const fallback = `call_${index}`;
    const rawId = item.call_id ?? item.id ?? fallback;
    if (typeof rawId === 'string' && rawId.trim().length > 0) {
      return rawId;
    }
    return fallback;
  }

  private normalizeFunctionCallOutputId(rawId: string | undefined, fallback: string): string {
    const base = rawId && rawId.length > 0 ? rawId : fallback;
    const sanitized = this.sanitizeId(base.replace(/^fco_/, ''));
    return sanitized.startsWith('fco_') ? sanitized : `fco_${sanitized}`;
  }

  private sanitizeId(id: string | undefined): string {
    if (!id) {
      return 'msg_default';
    }
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'msg_default';
  }

  private buildPrTitle(summary?: string): string {
    const defaultTitle = 'AI Hub automated fix';
    const prefix = 'AI Hub: ';
    const maxLength = 256;

    if (!summary || summary.trim().length === 0) {
      return defaultTitle;
    }

    const availableForSummary = Math.max(1, maxLength - prefix.length);
    const truncatedSummary = this.truncateWithEllipsis(summary.trim(), availableForSummary);
    return `${prefix}${truncatedSummary}`;
  }

  private buildPrBody(summary: string | undefined, taskDescription: string): string {
    const sections = [
      'Correção automática gerada pelo sandbox do AI Hub.',
      taskDescription ? `\n**Descrição da tarefa:**\n${taskDescription}` : undefined,
      summary ? `\n**Resumo das alterações:**\n${summary}` : undefined,
    ].filter(Boolean);

    return sections.join('\n');
  }

  private truncateWithEllipsis(value: string, maxLength: number): string {
    if (!value || maxLength <= 0) {
      return '';
    }
    if (value.length <= maxLength) {
      return value;
    }
    if (maxLength === 1) {
      return value.slice(0, maxLength);
    }
    return `${value.slice(0, maxLength - 1)}…`;
  }

  private truncate(value: string, maxLength = 200): string {
    if (!value) {
      return '';
    }
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
  }

  private logJson(job: SandboxJob, prefix: string, payload: unknown, maxLength = 2000) {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch (err) {
      serialized = `erro ao serializar payload: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.log(job, `${prefix}: ${this.truncate(serialized, maxLength)}`);
  }

  private sanitizeTaskDescription(description: string, job: SandboxJob): string {
    const { value, truncated, omitted } = this.truncateStringValue(description ?? '', this.maxTaskDescriptionChars);
    if (truncated) {
      this.log(
        job,
        `taskDescription com ${description.length} caracteres truncado para ${this.maxTaskDescriptionChars} para evitar erro de contexto (omitiu ${omitted} caracteres)`,
      );
    }
    return value;
  }

  private prepareToolOutput(result: unknown, job: SandboxJob): string {
    const truncation = { truncated: false };
    const sanitized = this.truncateStringFields(result, this.toolOutputStringLimit, truncation);
    let serialized: string;

    try {
      serialized = JSON.stringify(sanitized);
    } catch (err) {
      serialized = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    if (truncation.truncated) {
      this.log(
        job,
        `output de tool truncado para ${this.toolOutputStringLimit} caracteres por campo para evitar ultrapassar a janela de contexto`,
      );
    }

    const { value, truncated, omitted } = this.truncateStringValue(serialized, this.toolOutputSerializedLimit);
    if (truncated) {
      this.log(
        job,
        `output serializado da tool excedeu ${this.toolOutputSerializedLimit} caracteres e foi truncado (omitiu ${omitted} caracteres)`
      );
    }
    return value;
  }

  private truncateStringFields(value: unknown, maxLength: number, tracker: { truncated: boolean }): unknown {
    if (typeof value === 'string') {
      const truncated = this.truncateStringValue(value, maxLength);
      tracker.truncated = tracker.truncated || truncated.truncated;
      return truncated.value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.truncateStringFields(item, maxLength, tracker));
    }

    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.truncateStringFields(val, maxLength, tracker);
      }
      return result;
    }

    return value;
  }

  private truncateStringValue(value: string, maxLength: number): { value: string; truncated: boolean; omitted: number } {
    if (!Number.isFinite(maxLength) || maxLength <= 0 || value.length <= maxLength) {
      return { value, truncated: false, omitted: 0 };
    }

    const suffixBase = '... [truncated ';
    const suffixClose = ' chars]';
    const suffixLength = suffixBase.length + suffixClose.length + String(value.length).length;
    const available = Math.max(0, maxLength - suffixLength);
    const omitted = Math.max(0, value.length - available);
    const suffix = `${suffixBase}${omitted}${suffixClose}`;
    const truncatedValue = `${value.slice(0, available)}${suffix}`;

    return { value: truncatedValue, truncated: true, omitted };
  }

  private parsePositiveInteger(raw: string | undefined, defaultValue: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }
}
