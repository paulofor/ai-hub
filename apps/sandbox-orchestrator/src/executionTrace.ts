export type TraceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface TracePlan {
  id: string;
  turnId: string;
  receivedAt: string;
  explanation?: string;
  steps: Array<{ step: string; status: TraceStatus }>;
}
export interface TraceEvent {
  id: string;
  sequence: number;
  turnId: string;
  itemId?: string;
  planId?: string;
  stepIndex?: number;
  kind: 'plan' | 'command' | 'file' | 'tool' | 'search' | 'message' | 'turn';
  label: string;
  status: TraceStatus;
  receivedAt: string;
  finishedAt?: string;
  durationMs?: number;
  durationSource?: 'provider' | 'observed';
  result?: string;
  details?: { command?: string; output?: string; files?: string[] };
  evidence: Array<{ label: string; url: string }>;
}
export interface ExecutionTrace {
  version: 1;
  revision: number;
  plans: TracePlan[];
  events: TraceEvent[];
  droppedEvents: number;
  droppedPlans: number;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Shared at the public boundary: no arguments, raw reasoning, or arbitrary objects. */
export function sanitizeTraceText(value: string, secrets: string[] = []): string {
  let text = value;
  for (const secret of secrets) if (secret.length >= 6) text = text.split(secret).join('[oculto]');
  return text
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[oculto]@')
    .replace(/\bBearer\s+[^\s"'`,;]+/gi, 'Bearer [oculto]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[oculto]')
    .replace(/((?:password|passwd|secret|[\w-]*token|api[_-]?key|authorization|cookie|AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN))\s*["']?\s*[:=]\s*["']?)[^\s"'`,;&}]+/gi, '$1[oculto]');
}

export function safeTraceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || [...url.searchParams.keys()].some((key) => /token|key|secret|password|auth|signature/i.test(key))) return;
    return url.href;
  } catch { return; }
}

function status(value: unknown): TraceStatus | undefined {
  if (typeof value !== 'string') return;
  switch (value.replace(/[_-]/g, '').toLowerCase()) {
    case 'pending': return 'pending';
    case 'inprogress': case 'running': return 'running';
    case 'completed': case 'succeeded': case 'success': case 'ok': return 'completed';
    case 'failed': case 'error': case 'declined': return 'failed';
    case 'cancelled': case 'canceled': case 'interrupted': return 'cancelled';
    default: return;
  }
}

export class ExecutionTraceCollector {
  private readonly trace: ExecutionTrace = { version: 1, revision: 0, plans: [], events: [], droppedEvents: 0, droppedPlans: 0 };
  private sequence = 0;
  private readonly completedItems = new Set<string>();
  constructor(private readonly options: {
    now?: () => number; secrets?: string[]; repoUrl?: string; repoPath?: string; branch?: string;
    maxEvents?: number; maxPlans?: number;
  } = {}) {}

  snapshot(): ExecutionTrace | undefined {
    return this.trace.revision ? structuredClone(this.trace) : undefined;
  }

  addPlan(turnId: string, value: unknown): void {
    const params = record(value);
    if (!params || !Array.isArray(params.plan)) return;
    const steps = params.plan.slice(0, 40).flatMap((entry) => {
      const item = record(entry);
      const state = status(item?.status);
      const step = this.clean(item?.step, 2000);
      return step && state ? [{ step, status: state }] : [];
    });
    if (!steps.length) return;
    const explanation = this.clean(params.explanation, 1000);
    const previous = this.latestPlan(turnId);
    if (previous && JSON.stringify(previous.steps) === JSON.stringify(steps) && previous.explanation === explanation) return;
    const plan: TracePlan = { id: `plan-${++this.sequence}`, turnId, receivedAt: this.at(), steps, ...(explanation ? { explanation } : {}) };
    this.trace.plans.push(plan);
    if (this.trace.plans.length > (this.options.maxPlans ?? 80)) { this.trace.plans.shift(); this.trace.droppedPlans++; }
    this.append({ id: plan.id, sequence: this.sequence, turnId, planId: plan.id, kind: 'plan',
      label: previous ? 'Checklist atualizado' : 'Checklist publicado', status: 'completed', receivedAt: plan.receivedAt,
      result: `${steps.filter((step) => step.status === 'completed').length} de ${steps.length} etapas declaradas concluídas.`, evidence: [] });
  }

  item(turnId: string, value: unknown, completed: boolean): void {
    const item = record(value);
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') return;
    // Explicit allowlist: reasoning.content, prompts, tool arguments and arbitrary JSON never enter the trace.
    const type = item.type.replace(/_/g, '').toLowerCase();
    const kind: TraceEvent['kind'] | undefined = type === 'commandexecution' ? 'command'
      : type === 'filechange' ? 'file' : ['mcptoolcall', 'dynamictoolcall', 'collabtoolcall'].includes(type) ? 'tool'
        : type === 'websearch' ? 'search' : type === 'agentmessage' && item.phase === 'commentary' ? 'message' : undefined;
    if (!kind) return;
    const key = JSON.stringify([turnId, item.id]);
    let event = this.trace.events.find((entry) => entry.id === key);
    const hadStart = Boolean(event);
    if (this.completedItems.has(key) || (!completed && event && !['running', 'pending'].includes(event.status))) return;
    if (!event) {
      const plan = this.latestPlan(turnId);
      const stepIndex = plan?.steps.findIndex((step) => step.status === 'running');
      event = { id: key, sequence: ++this.sequence, turnId, itemId: item.id, kind,
        label: kind === 'command' ? 'Executar comando' : kind === 'file' ? 'Alterar arquivos'
          : kind === 'search' ? 'Consultar a web' : kind === 'message' ? 'Atualização pública' : 'Executar ferramenta',
        status: 'running', receivedAt: this.at(), evidence: [],
        ...(plan && stepIndex !== undefined && stepIndex >= 0 ? { planId: plan.id, stepIndex } : {}) };
      this.append(event);
    }
    const before = JSON.stringify(event);
    const command = this.clean(item.command, 2000);
    const error = this.clean(record(item.error)?.message ?? item.error, 2000);
    const toolResult = record(item.result);
    const resultText = Array.isArray(toolResult?.content) ? toolResult.content.flatMap((entry) => {
      const block = record(entry);
      return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [];
    }).join('\n') : undefined;
    const output = this.clean(item.aggregatedOutput ?? resultText ?? (kind === 'message' ? item.text : undefined), 5000);
    const files = Array.isArray(item.changes) ? item.changes.slice(0, 25).flatMap((entry) => {
      const path = this.clean(record(entry)?.path, 500);
      return path ? [path] : [];
    }) : [];
    const tool = this.clean(item.tool, 100);
    if (kind === 'tool' && tool) event.details = { ...event.details, command: tool };
    if (command || output || files.length) event.details = { ...event.details, ...(command ? { command } : {}), ...(output ? { output } : {}), ...(files.length ? { files } : {}) };
    if (error) event.details = { ...event.details, output: [output, error].filter(Boolean).join('\n') };
    for (const path of files) {
      const url = this.fileUrl(path);
      if (url) this.evidence(event, `Arquivo: ${path.split('/').pop()}`, url);
    }
    for (const url of (output ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? []) this.evidence(event, 'Abrir referência observada', url);
    if (completed) {
      this.completedItems.add(key);
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : undefined;
      event.status = error || item.success === false || toolResult?.isError === true || (exitCode !== undefined && exitCode !== 0)
        ? 'failed' : status(item.status) ?? 'completed';
      // A completed notification is authoritative even when its status was omitted.
      if (event.status === 'running' || event.status === 'pending') event.status = 'completed';
      event.finishedAt = this.at();
      if (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0) {
        event.durationMs = item.durationMs; event.durationSource = 'provider';
      } else if (hadStart) {
        event.durationMs = Date.parse(event.finishedAt) - Date.parse(event.receivedAt); event.durationSource = 'observed';
      }
      event.result = error ? 'A operação informou falha; consulte os detalhes.' : exitCode !== undefined ? `Comando encerrado com código ${exitCode}.`
        : event.status === 'failed' ? 'A operação informou falha.' : event.status === 'cancelled' ? 'Operação interrompida.'
          : kind === 'file' ? `${files.length} arquivo(s) informado(s) pelo executor.`
            : kind === 'message' ? this.clean(item.text, 240) ?? 'Atualização pública recebida.' : 'Conclusão informada pelo executor.';
    }
    if (JSON.stringify(event) !== before) this.trace.revision++;
  }

  finishTurn(turnId: string, state: unknown, reason?: string): void {
    const key = `turn:${turnId}`;
    if (this.trace.events.some((event) => event.id === key)) return;
    const outcome = status(state) ?? 'failed';
    const now = this.at();
    for (const event of this.trace.events) {
      if (event.turnId !== turnId || event.status !== 'running') continue;
      event.status = outcome === 'failed' ? 'failed' : 'cancelled';
      event.finishedAt = now;
      event.result = 'Turno encerrado sem confirmação de conclusão deste item.';
    }
    if (outcome === 'failed' || outcome === 'cancelled') {
      const previous = this.latestPlan(turnId);
      if (previous?.steps.some((step) => step.status === 'running')) this.addPlan(turnId, {
        plan: previous.steps.map((step) => step.status === 'running' ? { ...step, status: outcome } : step),
        explanation: 'A etapa ativa foi interrompida pelo encerramento do turno.',
      });
    }
    this.append({ id: key, sequence: ++this.sequence, turnId, kind: 'turn', label: 'Encerramento do turno',
      status: outcome, receivedAt: now,
      result: outcome === 'completed' ? 'Turno concluído; consulte os resultados das operações.' : 'Turno interrompido; consulte os detalhes.',
      ...(reason ? { details: { output: this.clean(reason, 2000) } } : {}), evidence: [] });
  }

  retry(turnId: string): void {
    this.append({ id: `retry-${++this.sequence}`, sequence: this.sequence, turnId, kind: 'turn',
      label: 'Retomada da execução', status: 'completed', receivedAt: this.at(),
      result: 'Nova tentativa na mesma solicitação; resultados anteriores preservados.', evidence: [] });
  }

  private clean(value: unknown, limit: number): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return;
    const text = sanitizeTraceText(value, this.options.secrets).trim();
    return text.length > limit ? `${text.slice(0, limit)}\n[Trecho limitado]` : text;
  }
  private at(): string { return new Date((this.options.now ?? Date.now)()).toISOString(); }
  private latestPlan(turnId: string): TracePlan | undefined { return [...this.trace.plans].reverse().find((plan) => plan.turnId === turnId); }
  private append(event: TraceEvent): void {
    this.trace.events.push(event);
    if (this.trace.events.length > (this.options.maxEvents ?? 400)) {
      const terminal = this.trace.events.findIndex((entry) => !['running', 'pending'].includes(entry.status));
      const [removed] = this.trace.events.splice(terminal >= 0 ? terminal : 0, 1);
      this.completedItems.delete(removed.id);
      this.trace.droppedEvents++;
    }
    this.trace.revision++;
  }
  private evidence(event: TraceEvent, label: string, value: string): void {
    const url = safeTraceUrl(value);
    if (!url || event.evidence.length >= 8 || event.evidence.some((entry) => entry.url === url)) return;
    event.evidence.push({ label, url });
  }
  private fileUrl(path: string): string | undefined {
    const url = this.options.repoUrl && safeTraceUrl(this.options.repoUrl);
    if (!url || new URL(url).hostname !== 'github.com') return;
    const relative = path.startsWith('/') ? this.options.repoPath && path.startsWith(`${this.options.repoPath}/`)
      ? path.slice(this.options.repoPath.length + 1) : undefined : path;
    if (!relative || relative.split('/').includes('..')) return;
    return `${url.replace(/\.git$/, '').replace(/\/$/, '')}/blob/${encodeURIComponent(this.options.branch ?? 'main')}/${relative.split('/').map(encodeURIComponent).join('/')}`;
  }
}
