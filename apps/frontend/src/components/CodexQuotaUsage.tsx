import { formatDateTime } from '../lib/codex';

interface WindowUsage {
  limitId: string;
  windowDurationMins: number;
  usedPercent: number;
  finalUsedPercent?: number;
  consumedPercentagePoints?: number;
  reason?: string;
  resetsAt: number;
}
interface Usage {
  status: string;
  start: { capturedAt: string };
  end?: { capturedAt: string };
  concurrentObserved: boolean;
  windows: WindowUsage[];
}
const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const reasons: Record<string, string> = {
  account_unavailable: 'Conta não identificada', account_changed: 'Conta alterada',
  reading_unavailable: 'Leitura final indisponível', window_reset: 'Cota renovada ou janela alterada',
  inconsistent_reading: 'Leituras inconsistentes'
};
const label = (window: WindowUsage) => `${window.limitId} · ${window.windowDurationMins === 10080 ? 'semanal' : window.windowDurationMins === 300 ? '5 horas' : `${number(window.windowDurationMins)} min`}`;
function parse(raw?: string): Usage | undefined {
  try {
    const value = JSON.parse(raw ?? 'null');
    return value && typeof value.start?.capturedAt === 'string' && Array.isArray(value.windows)
      && value.windows.every((window: WindowUsage) => window && typeof window.limitId === 'string'
        && Number.isFinite(window.windowDurationMins) && Number.isFinite(window.usedPercent)
        && Number.isFinite(window.resetsAt)) ? value : undefined;
  } catch { return undefined; }
}
export function CodexQuotaUsage({ raw, detail = false }: { raw?: string; detail?: boolean }) {
  const usage = parse(raw);
  const allWindows = usage?.windows ?? [];
  // The compact history summarizes the primary weekly Codex allowance. The
  // detail view remains the source for every window reported by the provider.
  const windows = detail
    ? allWindows
    : allWindows.filter((window) => window.limitId === 'codex' && window.windowDurationMins === 10080);
  const text = !usage ? 'Indisponível' : usage.status === 'measuring' ? 'Em medição' : windows.length === 0 ? 'Indisponível' : undefined;
  const explanation = 'Estimativa da variação da cota da conta durante a solicitação. Pode incluir outras execuções e uso externo. Arredondamento e atraso do provedor podem ocultar consumo; 0 p.p. não comprova consumo zero. Não é custo em dinheiro.';
  return <div data-testid="codex-quota-usage" className={detail ? 'rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700' : 'text-xs text-slate-600 dark:text-slate-400'} title={explanation}>
    <span className="font-semibold">Consumo de cota{detail ? ' (estimado)' : ''}: </span>
    {text ?? windows.map((window, index) => <span key={`${window.limitId}-${index}`} className={detail ? 'mt-2 block' : 'mr-3 inline-block'}>
      {label(window)}: <strong>{typeof window.consumedPercentagePoints === 'number' ? `${number(window.consumedPercentagePoints)} p.p.${detail ? '' : ' (estimado)'}` : reasons[window.reason ?? ''] ?? 'Indisponível'}</strong>
      {detail && <span className="block text-slate-500">Cota utilizada: {number(window.usedPercent)}% → {typeof window.finalUsedPercent === 'number' ? `${number(window.finalUsedPercent)}%` : 'indisponível'} · Renovação da janela inicial: {formatDateTime(new Date(window.resetsAt * 1000).toISOString())}</span>}
    </span>)}
    {detail && <>
      {usage && <p className="mt-2 text-slate-500">Leitura inicial: {formatDateTime(usage.start.capturedAt)} · Final: {usage.end ? formatDateTime(usage.end.capturedAt) : 'pendente'}</p>}
      {usage?.concurrentObserved && <p className="mt-2">Houve execuções simultâneas nesta conta.</p>}
      <p className="mt-2 text-slate-500">{explanation}</p>
    </>}
  </div>;
}
