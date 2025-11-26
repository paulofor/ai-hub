import { exec as execCallback } from 'node:child_process';
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
  }

  async process(job: SandboxJob): Promise<void> {
    job.status = 'RUNNING';
    job.updatedAt = new Date().toISOString();
    const workspace = await this.prepareWorkspace(job);
    const repoPath = path.join(workspace, 'repo');
    job.sandboxPath = workspace;
    this.log(job, `workspace criado em ${workspace}`);

    try {
      const cloneToken =
        process.env.GITHUB_CLONE_TOKEN ?? process.env.GITHUB_TOKEN ?? extractTokenFromRepoUrl(job.repoUrl);
      const cloneUrl = buildAuthRepoUrl(job.repoUrl, cloneToken, process.env.GITHUB_CLONE_USERNAME);
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
      await this.maybeCreatePullRequest(job, repoPath, cloneToken, baseCommit, job.patch);
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
            }. Sempre trabalhe somente dentro do diretório do repositório.`,
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
      this.log(job, 'resposta do modelo recebida');

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

      this.log(job, `modelo retornou ${toolCalls.length} chamadas de ferramenta e mensagem=${Boolean(assistantMessage)}`);

      const text = this.extractOutputText(assistantMessage?.content);
      if (toolCalls.length === 0) {
        summary = text ?? summary;
        if (assistantMessage) {
          messages.push(assistantMessage);
        }
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
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: JSON.stringify(result),
            type: 'function_call_output',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(job, `erro ao executar tool ${toolCall.name}: ${message}`);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: JSON.stringify({ error: message }),
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

  private resolvePath(repoPath: string, requested: string | undefined): string {
    if (!requested) {
      throw new Error('path ausente');
    }
    const absolute = path.resolve(repoPath, requested);
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
    const command = Array.isArray(args.command) ? (args.command as string[]) : undefined;
    if (!command || command.length === 0) {
      throw new Error('command é obrigatório para run_shell');
    }
    const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
    const cwd = cwdArg ? this.resolvePath(repoPath, cwdArg) : repoPath;
    await this.assertDirectoryExists(cwd);
    const joined = command.map((part) => part.trim()).join(' ');
    this.log(job, `run_shell: ${joined} (cwd=${cwd})`);
    const { stdout, stderr } = await exec(joined, { cwd });
    return { stdout, stderr };
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
    cloneToken?: string,
    baseCommit?: string,
    diffPatch?: string,
  ): Promise<void> {
    const token =
      process.env.GITHUB_PR_TOKEN ??
      cloneToken ??
      process.env.GITHUB_CLONE_TOKEN ??
      process.env.GITHUB_TOKEN ??
      extractTokenFromRepoUrl(job.repoUrl) ??
      undefined;
    if (!token) {
      this.log(job, 'GITHUB_PR_TOKEN/GITHUB_CLONE_TOKEN não configurado; ignorando criação de PR');
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
        process.env.GITHUB_CLONE_USERNAME ?? 'x-access-token',
      );
      await exec(`git remote set-url origin ${authenticatedRemote}`, { cwd: repoPath });
      await exec(`git push origin ${branchName}`, { cwd: repoPath });

      const prTitle = job.summary ? `AI Hub: ${job.summary}` : 'AI Hub automated fix';
      const prBody = 'Correção automática gerada pelo sandbox do AI Hub.';
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
        throw new Error(`Falha ao criar PR: ${response.status} ${message}`);
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

  private log(job: SandboxJob, message: string) {
    const entry = `[${new Date().toISOString()}] ${message}`;
    job.logs.push(entry);
    console.info(`Sandbox job ${job.jobId}: ${message}`);
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
}
