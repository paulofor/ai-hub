export type TraceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface TracePlan {
  id: string; turnId: string; receivedAt: string; explanation?: string;
  steps: Array<{ step: string; status: TraceStatus }>;
}
export interface TraceEvent {
  id: string; sequence: number; turnId: string; itemId?: string; planId?: string; stepIndex?: number;
  kind: string; label: string; status: TraceStatus; receivedAt: string; finishedAt?: string;
  durationMs?: number; durationSource?: string; result?: string;
  details?: { command?: string; output?: string; files?: string[] };
  evidence: Array<{ label: string; url: string }>;
}
export interface ExecutionTrace {
  version: 1; revision: number; plans: TracePlan[]; events: TraceEvent[];
  droppedEvents: number; droppedPlans: number;
}

const states: TraceStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
const obj = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;
const state = (value: unknown): TraceStatus | undefined => states.includes(value as TraceStatus) ? value as TraceStatus : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const date = (value: unknown): string | undefined => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || [...url.searchParams.keys()].some((key) => /token|key|secret|password|auth|signature/i.test(key))) return;
    return url.href;
  } catch { return; }
}

/** Read only the public contract. Malformed or legacy payloads do not crash the detail page. */
export function parseExecutionTrace(value: unknown): ExecutionTrace | undefined {
  try {
    const root = obj(typeof value === 'string' ? JSON.parse(value) : value);
    if (root?.version !== 1 || !Number.isInteger(root.revision) || (root.revision as number) < 1
      || !Array.isArray(root.plans) || !Array.isArray(root.events)) return;
    const plans: TracePlan[] = root.plans.slice(-80).flatMap((entry) => {
      const plan = obj(entry);
      if (!plan || !text(plan.id) || !text(plan.turnId) || !date(plan.receivedAt) || !Array.isArray(plan.steps)) return [];
      const steps = plan.steps.slice(0, 40).flatMap((entry) => {
        const step = obj(entry);
        return step && text(step.step) && state(step.status) ? [{ step: text(step.step)!, status: state(step.status)! }] : [];
      });
      return [{ id: text(plan.id)!, turnId: text(plan.turnId)!, receivedAt: date(plan.receivedAt)!, explanation: text(plan.explanation), steps }];
    });
    const ids = new Set<string>();
    const events: TraceEvent[] = root.events.slice(-400).flatMap((entry) => {
      const event = obj(entry);
      if (!event || !text(event.id) || ids.has(text(event.id)!) || !text(event.turnId) || !text(event.label)
        || !state(event.status) || !date(event.receivedAt) || number(event.sequence) === undefined) return [];
      ids.add(text(event.id)!);
      const details = obj(event.details);
      const evidence = Array.isArray(event.evidence) ? event.evidence.slice(0, 8).flatMap((entry) => {
        const link = obj(entry); const url = safeUrl(link?.url);
        return url ? [{ label: text(link?.label) ?? 'Abrir referência', url }] : [];
      }) : [];
      return [{ id: text(event.id)!, sequence: number(event.sequence)!, turnId: text(event.turnId)!,
        itemId: text(event.itemId), planId: text(event.planId), stepIndex: number(event.stepIndex), kind: text(event.kind) ?? 'tool',
        label: text(event.label)!, status: state(event.status)!, receivedAt: date(event.receivedAt)!, finishedAt: date(event.finishedAt),
        durationMs: number(event.durationMs), durationSource: text(event.durationSource), result: text(event.result), evidence,
        details: details ? { command: text(details.command), output: text(details.output),
          files: Array.isArray(details.files) ? details.files.filter((path): path is string => typeof path === 'string').slice(0, 25) : undefined } : undefined }];
    });
    return { version: 1, revision: root.revision as number, plans, events: events.sort((a, b) => a.sequence - b.sequence),
      droppedEvents: number(root.droppedEvents) ?? 0, droppedPlans: number(root.droppedPlans) ?? 0 };
  } catch { return; }
}

/** Extract only the old collector's well-defined checklist prefix; do not invent event history. */
export function legacyChecklist(summary?: string): { steps: TracePlan['steps']; summary?: string } {
  if (!summary?.startsWith('**Objetivos**\n')) return { steps: [], summary };
  const blocks = summary.split('\n\n');
  const steps: TracePlan['steps'] = [];
  while (blocks[0]?.startsWith('**Objetivos**\n')) {
    const lines = blocks.shift()!.split('\n').slice(1);
    for (const line of lines) {
      const match = line.match(/^- \[([ x])\] (.+)$/);
      if (match) steps.push({ step: match[2], status: match[1] === 'x' ? 'completed' : 'pending' });
    }
  }
  return { steps, summary: blocks.join('\n\n') || undefined };
}
