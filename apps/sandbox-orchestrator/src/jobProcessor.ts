import { exec as execCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';

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
    job.logs.push(`workspace: ${workspace}`);

    try {
      await this.cloneRepository(job, repoPath);
      if (!this.openai) {
        throw new Error('OPENAI_API_KEY não configurada no sandbox orchestrator');
      }

      const summary = await this.runCodexLoop(job, repoPath);
      job.summary = summary;
      job.changedFiles = await this.collectChangedFiles(repoPath);
      job.patch = await this.generatePatch(repoPath);
      job.status = 'COMPLETED';
    } catch (error) {
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message : String(error);
      job.logs.push(job.error);
    } finally {
      job.updatedAt = new Date().toISOString();
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

  private async cloneRepository(job: SandboxJob, repoPath: string): Promise<void> {
    job.logs.push(`cloning ${job.repoUrl} (branch ${job.branch})`);
    await exec(`git clone --branch ${job.branch} --depth 1 ${job.repoUrl} ${repoPath}`);
    if (job.commitHash) {
      job.logs.push(`checking out commit ${job.commitHash}`);
      await exec(`git checkout ${job.commitHash}`, { cwd: repoPath });
    }
  }

  private buildTools(repoPath: string) {
    return [
      {
        type: 'function',
        function: {
          name: 'run_shell',
          description: 'Executa um comando de shell dentro do sandbox clonado',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'array', items: { type: 'string' } },
              cwd: { type: 'string', description: 'Diretório relativo ao repo' },
            },
            required: ['command'],
          },
          strict: true,
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Lê um arquivo do repositório clonado',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
          strict: true,
        },
      },
      {
        type: 'function',
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
          },
          strict: true,
        },
      },
    ];
  }

  private async runCodexLoop(job: SandboxJob, repoPath: string): Promise<string> {
    const tools = this.buildTools(repoPath);
    let response = await this.openai!.responses.create({
      model: this.model,
      input: [
        {
          role: 'system',
          content: `Você está operando em um sandbox isolado em ${repoPath}. Use as tools para ler, alterar arquivos e executar comandos. Test command sugerido: ${job.testCommand ?? 'n/d'}. Sempre trabalhe somente dentro do diretório do repositório.`,
        },
        { role: 'user', content: job.taskDescription },
      ],
      tools,
    } as any);

    let summary = this.extractText(response.output) ?? '';

    while (true) {
      const toolCalls = this.extractToolCalls(response.output);
      if (toolCalls.length === 0) {
        return summary;
      }

      const toolOutputs = [] as { tool_call_id: string; output: string }[];
      for (const call of toolCalls) {
        const result = await this.dispatchTool(call, repoPath, job);
        toolOutputs.push({ tool_call_id: call.id, output: JSON.stringify(result) });
      }

      response = await this.openai!.responses.create({
        model: this.model,
        previous_response_id: response.id,
        tool_outputs: toolOutputs,
      } as any);

      const updatedSummary = this.extractText(response.output);
      summary = updatedSummary ?? summary;
    }
  }

  private extractText(output: unknown): string | undefined {
    if (!Array.isArray(output)) {
      return undefined;
    }
    const texts: string[] = [];
    for (const item of output) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const asAny = item as Record<string, unknown>;
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

  private extractToolCalls(output: unknown): ToolCall[] {
    if (!Array.isArray(output)) {
      return [];
    }
    const calls: ToolCall[] = [];
    for (const item of output) {
      const objectItem = item as Record<string, unknown>;
      if (objectItem.type !== 'function_call' && objectItem.type !== 'tool_call') {
        continue;
      }
      const functionNode = objectItem.function as Record<string, unknown> | undefined;
      const name = (objectItem.name as string) || (functionNode?.name as string);
      const args = this.parseArguments(objectItem.arguments ?? functionNode?.arguments);
      if (!name || !args) {
        continue;
      }
      calls.push({
        id: (objectItem.id as string) ?? randomUUID(),
        name,
        arguments: args,
      });
    }
    return calls;
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

  private async handleRunShell(args: Record<string, unknown>, repoPath: string, job: SandboxJob) {
    const command = Array.isArray(args.command) ? (args.command as string[]) : undefined;
    if (!command || command.length === 0) {
      throw new Error('command é obrigatório para run_shell');
    }
    const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
    const cwd = cwdArg ? this.resolvePath(repoPath, cwdArg) : repoPath;
    const joined = command.map((part) => part.trim()).join(' ');
    job.logs.push(`run_shell: ${joined} (cwd=${cwd})`);
    const { stdout, stderr } = await exec(joined, { cwd });
    return { stdout, stderr };
  }

  private async handleReadFile(args: Record<string, unknown>, repoPath: string) {
    const filePath = this.resolvePath(repoPath, typeof args.path === 'string' ? args.path : undefined);
    const content = await fs.readFile(filePath, 'utf8');
    return { content };
  }

  private async handleWriteFile(args: Record<string, unknown>, repoPath: string, job: SandboxJob) {
    const filePath = this.resolvePath(repoPath, typeof args.path === 'string' ? args.path : undefined);
    const content = typeof args.content === 'string' ? args.content : '';
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    job.logs.push(`write_file: ${filePath}`);
    return { status: 'ok' };
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
}
