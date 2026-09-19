type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

/** Collect only public summaries, never raw reasoning/content. */
export class ReasoningSummaryCollector {
  private readonly items = new Map<string, { parts: Map<number, string>; completed: boolean }>();
  private readonly plans = new Map<string, string>();

  addPlanUpdate(turnId: string, params: unknown): void {
    const event = object(params);
    if (!event || !Array.isArray(event.plan)) return;
    const steps = event.plan.flatMap((entry: unknown) => {
      const step = object(entry);
      if (!step || typeof step.step !== 'string' || !step.step.trim()) return [];
      const marker = step.status === 'completed' ? 'x' : ' ';
      return [`- [${marker}] ${step.step.trim()}`];
    });
    const explanation = typeof event.explanation === 'string' ? event.explanation.trim() : '';
    const text = [explanation, ...steps].filter(Boolean).join('\n');
    if (text) this.plans.set(turnId, `**Objetivos**\n${text}`);
  }

  addDelta(turnId: string, params: unknown): void {
    const event = object(params);
    if (!event || typeof event.itemId !== 'string' || !event.itemId
      || typeof event.delta !== 'string' || !Number.isInteger(event.summaryIndex)
      || (event.summaryIndex as number) < 0) return;
    const item = this.item(turnId, event.itemId);
    if (item.completed) return;
    const index = event.summaryIndex as number;
    item.parts.set(index, (item.parts.get(index) ?? '') + event.delta);
  }

  completeItem(turnId: string, value: unknown): void {
    const event = object(value);
    if (event?.type !== 'reasoning' || typeof event.id !== 'string' || !event.id || !Array.isArray(event.summary)) return;
    const parts = event.summary.map((entry: unknown) => {
      if (typeof entry === 'string') return entry;
      const part = object(entry);
      return part?.type === 'summary_text' && typeof part.text === 'string' ? part.text : '';
    });
    // Preserve streamed text when a provider omits the final summary.
    if (!parts.some((part: string) => part.trim())) return;
    const item = this.item(turnId, event.id);
    item.parts = new Map(parts.map((part: string, index: number) => [index, part]));
    item.completed = true;
  }

  text(): string | undefined {
    const summaries = [...this.items.values()]
      .flatMap((item) => [...item.parts.entries()].sort(([a], [b]) => a - b).map(([, text]) => text.trim()))
      .filter(Boolean);
    const text = [...this.plans.values(), ...summaries].join('\n\n');
    return text || undefined;
  }

  private item(turnId: string, itemId: string) {
    const key = JSON.stringify([turnId, itemId]);
    let item = this.items.get(key);
    if (!item) {
      item = { parts: new Map(), completed: false };
      this.items.set(key, item);
    }
    return item;
  }
}

/** Keep the request contract of non-reasoning models used by economy profiles. */
export function requestsReasoningSummary(model: string): boolean {
  return /^(?:gpt-(?:5|6)(?:[.-]|$)|gpt-daybreak-blue(?:-|$)|o[34](?:-|$))/.test(model);
}
