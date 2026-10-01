import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { CodexProfile, CodexReasoningEffort, formatDateTime } from '../lib/codex';

interface QueueItem {
  id: number;
  environment: string;
  model: string;
  reasoningEffort?: CodexReasoningEffort;
  status: 'PENDING' | 'RUNNING';
  requestTitle: string;
  createdAt: string;
  startedAt?: string;
  queuePosition: number;
}

interface QueueSnapshot {
  profile: CodexProfile;
  updatedAt: string;
  requests: QueueItem[];
}

const POLL_INTERVAL_MS = 15_000;

export default function CodexRequestQueue({ profile, refreshKey }: { profile: CodexProfile; refreshKey: number }) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timeoutId: number | undefined;
    const controller = new AbortController();

    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const response = await client.get<QueueSnapshot>('/codex/requests/queue', {
          params: { profile }, timeout: 10_000, signal: controller.signal
        });
        if (cancelled) return;
        if (response.data.profile !== profile || !Array.isArray(response.data.requests)) {
          throw new Error('Consulta da fila inválida.');
        }
        setSnapshot(response.data);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };

    const poll = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!cancelled) timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void poll();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      controller.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [profile, refreshKey, manualRefresh]);

  const current = snapshot?.profile === profile ? snapshot : null;
  const running = current?.requests.filter(item => item.status === 'RUNNING') ?? [];
  const pending = current?.requests.filter(item => item.status === 'PENDING') ?? [];

  const renderItems = (items: QueueItem[]) => <ul className="space-y-2">
    {items.map(item => <li key={item.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/codex/requests/${item.id}`} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300">Solicitação #{item.id}</Link>
        <span className={item.status === 'RUNNING' ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}>
          {item.status === 'RUNNING' ? 'Em execução' : `Pendente · posição ${item.queuePosition}`}
        </span>
      </div>
      <p className="mt-1 break-words [overflow-wrap:anywhere]">{item.requestTitle}</p>
      <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">{item.environment} · {item.model}</p>
    </li>)}
  </ul>;

  return <section aria-label="Fila de solicitações" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Fila de solicitações</h3>
      <button type="button" disabled={loading} onClick={() => setManualRefresh(value => value + 1)} className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-300">Atualizar fila</button>
    </div>
    {error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">Não foi possível atualizar a fila: {error}{current ? ' A última consulta foi preservada.' : ''}</p> : null}
    {current ? <>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-300">Em execução ({running.length})</h4>
          {running.length > 0 ? renderItems(running) : <p className="text-xs text-slate-500">Nenhuma solicitação em execução.</p>}
        </div>
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Pendentes ({pending.length})</h4>
          {pending.length > 0 ? renderItems(pending) : <p className="text-xs text-slate-500">Nenhuma solicitação pendente.</p>}
        </div>
      </div>
      <p className="text-xs text-slate-500">Consulta do servidor: {formatDateTime(current.updatedAt)}. Atualização automática a cada 15 segundos, incluindo solicitações de todos os ambientes deste perfil.</p>
    </> : !error ? <p role="status" className="text-xs text-slate-500">Consultando a fila no servidor...</p> : null}
  </section>;
}
