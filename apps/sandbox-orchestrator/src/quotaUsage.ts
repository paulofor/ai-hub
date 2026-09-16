import { createHash } from 'node:crypto';
import type { CodexAppServerClient } from './codexAppServerClient.js';

export interface QuotaWindow {
  limitId: string;
  window: 'primary' | 'secondary';
  windowDurationMins: number;
  resetsAt: number;
  usedPercent: number;
}
export interface QuotaSnapshot {
  capturedAt: string;
  accountKey?: string;
  windows: QuotaWindow[];
}
export interface QuotaUsage {
  version: 1;
  status: 'measuring' | 'estimated' | 'unavailable';
  start: QuotaSnapshot;
  end?: QuotaSnapshot;
  eventsObserved: number;
  lastEvent?: { capturedAt: string; windows: QuotaWindow[] };
  concurrentObserved: boolean;
  accountChanged: boolean;
  windows: Array<QuotaWindow & { finalUsedPercent?: number; consumedPercentagePoints?: number; reason?: string }>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function quotaWindows(payload: unknown): QuotaWindow[] {
  const root = object(payload);
  const byId = object(root.rateLimitsByLimitId);
  const entries = Object.keys(byId).length ? Object.entries(byId) : [[String(object(root.rateLimits).limitId ?? 'codex'), root.rateLimits]];
  const result: QuotaWindow[] = [];
  for (const [limitId, raw] of entries) {
    for (const window of ['primary', 'secondary'] as const) {
      const value = object(object(raw)[window]);
      const { usedPercent, windowDurationMins, resetsAt } = value;
      if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100
        || typeof windowDurationMins !== 'number' || !Number.isInteger(windowDurationMins) || windowDurationMins <= 0
        || typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) continue;
      result.push({ limitId: String(limitId), window, usedPercent, windowDurationMins, resetsAt });
    }
  }
  return result;
}

export async function readQuotaSnapshot(client: CodexAppServerClient): Promise<QuotaSnapshot> {
  const snapshot: QuotaSnapshot = { capturedAt: new Date().toISOString(), windows: [] };
  try {
    const raw = object(await client.request('account/read', { refreshToken: false }, 5000));
    const account = object(raw.account);
    const identity = account.id ?? account.accountId ?? account.email;
    if (typeof identity === 'string' && identity) {
      snapshot.accountKey = createHash('sha256').update(JSON.stringify([identity, account.planType])).digest('hex');
    }
    snapshot.windows = quotaWindows(await client.request('account/rateLimits/read', {}, 5000));
  } catch {
    // Telemetry is optional. Never expose provider errors or interrupt the user's task.
  }
  snapshot.capturedAt = new Date().toISOString();
  return snapshot;
}

export function finishQuotaUsage(usage: QuotaUsage, end: QuotaSnapshot): void {
  usage.end = end;
  usage.windows = usage.start.windows.map((start) => {
    const final = end.windows.find((value) => value.limitId === start.limitId && value.window === start.window);
    let reason: string | undefined;
    if (!usage.start.accountKey || !end.accountKey) reason = 'account_unavailable';
    else if (usage.accountChanged || usage.start.accountKey !== end.accountKey) reason = 'account_changed';
    else if (!final) reason = 'reading_unavailable';
    else if (start.windowDurationMins !== final.windowDurationMins || start.resetsAt !== final.resetsAt
      || Date.parse(end.capturedAt) >= start.resetsAt * 1000) reason = 'window_reset';
    else if (final.usedPercent < start.usedPercent) reason = 'inconsistent_reading';
    return { ...start, finalUsedPercent: final?.usedPercent, reason,
      consumedPercentagePoints: !reason && final ? Math.round((final.usedPercent - start.usedPercent) * 10000) / 10000 : undefined };
  });
  usage.status = usage.windows.some((window) => window.consumedPercentagePoints !== undefined) ? 'estimated' : 'unavailable';
}

const active = new WeakMap<CodexAppServerClient, Set<QuotaUsage>>();
export function observeQuota(client: CodexAppServerClient, usage: QuotaUsage): () => void {
  const peers = active.get(client) ?? new Set<QuotaUsage>();
  if (peers.size) {
    usage.concurrentObserved = true;
    peers.forEach((peer) => { peer.concurrentObserved = true; });
  }
  peers.add(usage);
  active.set(client, peers);
  const offLimits = client.onNotification('account/rateLimits/updated', (payload) => {
    usage.eventsObserved += 1;
    usage.lastEvent = { capturedAt: new Date().toISOString(), windows: quotaWindows(payload) };
  });
  const offAccount = client.onNotification('account/updated', () => { usage.accountChanged = true; });
  return () => { peers.delete(usage); offLimits(); offAccount(); };
}
