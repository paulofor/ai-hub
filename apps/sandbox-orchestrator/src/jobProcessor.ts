import { exec as execCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources/index.mjs';

import { buildAuthRepoUrl, redactUrlCredentials } from './git.js';
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

  constructor(apiKey?: string, model = 'gpt-5-codex', openaiClient?: OpenAI) {
    this.model = model;
    if (openaiClient) {
      this.openai = openaiClient;
    } else if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  async process(job: SandboxJob): Promise<void> {
    job.status = 'RUNNING';
    job.updatedAt = new Date().toISOString();
    const workspace = await this.prepareWorkspace(job);
    const repoPath = path.join(workspace, 'repo');
    job.sandboxPath = workspace;
    this.log(job, `workspace criado em ${workspace}`);

    try {
      const cloneUrl = buildAuthRepoUrl(
        job.repoUrl,
        process.env.GITHUB_CLONE_TOKEN ?? process.env.GITHUB_TOKEN,
        process.env.GITHUB_CLONE_USERNAME,
      );
      this.log(job, `clonando repositório ${redactUrlCredentials(cloneUrl)} (branch ${job.branch})`);
      await this.cloneRepository(job, repoPath, cloneUrl);
      if (!this.openai) {
        throw new Error('OPENAI_API_KEY não configurada no sandbox orchestrator');
      }

      this.log(job, 'iniciando interação com o modelo do sandbox');
      const summary = await this.runCodexLoop(job, repoPath);
      job.summary = summary;
      job.changedFiles = await this.collectChangedFiles(repoPath);
      job.patch = await this.generatePatch(repoPath);
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
        function: {
          name: 'run_shell',
          description: 'Executa um comando de shell dentro do sandbox clonado',
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
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'read_file',
          description: 'Lê um arquivo do repositório clonado',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'write_file',
          description: 'Escreve um arquivo dentro do repositório clonado',
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
        },
      },
    ];
  }

  private async runCodexLoop(job: SandboxJob, repoPath: string): Promise<string> {
    const tools = this.buildTools(repoPath);
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `Você está operando em um sandbox isolado em ${repoPath}. Use as tools para ler, alterar arquivos e executar comandos. Test command sugerido: ${
          job.testCommand ?? 'n/d'
        }. Sempre trabalhe somente dentro do diretório do repositório.`,
      },
      { role: 'user', content: job.taskDescription },
    ];

    let summary = '';
    this.log(job, 'loop do modelo iniciado; aguardando chamadas de ferramenta');

    while (true) {
      const completion = await this.openai!.chat.completions.create({
        model: this.model,
        messages,
        tools,
      });

      const choice = completion.choices?.[0];
      const message = choice?.message;
      if (!message) {
        throw new Error('Resposta vazia do modelo');
      }

      const text = this.extractText(message.content);
      if (!message.tool_calls || message.tool_calls.length === 0) {
        summary = text ?? summary;
        messages.push({ role: 'assistant', content: message.content ?? text ?? '' });
        this.log(job, 'modelo concluiu sem novas tool calls');
        return summary;
      }

      messages.push({
        role: 'assistant',
        content: message.content ?? text ?? '',
        tool_calls: message.tool_calls,
      });

      const toolMessages: ChatCompletionMessageParam[] = [];
      for (const call of message.tool_calls) {
        const parsedArgs = this.parseArguments(call.function?.arguments);
        const toolCall: ToolCall = {
          id: call.id,
          name: call.function?.name ?? '',
          arguments: parsedArgs ?? {},
        };
        this.log(job, `executando tool ${toolCall.name}`);
        try {
          const result = await this.dispatchTool(toolCall, repoPath, job);
          toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(job, `erro ao executar tool ${toolCall.name}: ${message}`);
          toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: message }) });
        }
      }

      messages.push(...toolMessages);
    }
  }

  private extractText(output: string | ChatCompletionContentPart[] | null | undefined): string | undefined {
    if (typeof output === 'string') {
      const trimmed = output.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (!Array.isArray(output)) {
      return undefined;
    }
    const texts: string[] = [];
    for (const item of output) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const asAny = item as unknown as Record<string, unknown>;
      if (typeof asAny.text === 'string') {
        texts.push(asAny.text);
      }
      const content = asAny.content;
      if (Array.isArray(content)) {
        for (const contentItem of content) {
          const text = (contentItem as Record<string, unknown>).text;
          if (typeof text === 'string') {
            texts.push(text);
          }
        }
      }
    }
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

  private async collectChangedFiles(repoPath: string): Promise<string[]> {
    if (!(await this.isGitRepository(repoPath))) {
      return [];
    }
    const { stdout } = await exec('git status --porcelain', { cwd: repoPath });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line)
      .map((line) => line.replace(/^..\s+/, ''));
  }

  private async generatePatch(repoPath: string): Promise<string> {
    if (!(await this.isGitRepository(repoPath))) {
      return '';
    }
    const { stdout } = await exec('git diff', { cwd: repoPath });
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

  private log(job: SandboxJob, message: string) {
    const entry = `[${new Date().toISOString()}] ${message}`;
    job.logs.push(entry);
    console.log(`Sandbox job ${job.jobId}: ${message}`);
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
}
