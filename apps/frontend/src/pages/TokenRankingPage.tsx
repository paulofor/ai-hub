import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { CodexProfile, CodexReasoningEffort, CodexStatus, formatDuration } from '../lib/codex';

interface TokenRankingItem {
  id: number;
  environment: string;
  model: string;
  reasoningEffort: CodexReasoningEffort;
  profile?: CodexProfile;
  status: CodexStatus;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
  cost?: number;
  durationMs?: number;
  createdAt: string;
}

const numberFormatter = new Intl.NumberFormat('pt-BR');
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const statusLabel: Record<CodexStatus, string> = {
  PENDING: 'Pendente',
  RUNNING: 'Em execução',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada'
};

const statusStyle: Record<CodexStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  RUNNING: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  FAILED: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  CANCELLED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
};

export default function TokenRankingPage() {
  const [items, setItems] = useState<TokenRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get<TokenRankingItem[]>('/codex/requests/token-ranking')
      .then((response) => setItems(response.data))
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-6">
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-emerald-950 to-emerald-700 p-6 text-white shadow-xl sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-200">Consumo do Codex</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Ranking de tokens</h2>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50/80">As 20 solicitações com maior consumo total, ordenadas da maior para a menor.</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-right backdrop-blur">
            <span className="block text-2xl font-bold">Top 20</span>
            <span className="text-xs text-emerald-100">atualizado ao abrir</span>
          </div>
        </div>
      </header>

      {loading ? <div className="rounded-xl border bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-950">Carregando ranking…</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">Não foi possível carregar o ranking: {error}</div> : null}
      {!loading && !error && items.length === 0 ? <div className="rounded-xl border bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-950">Ainda não existem solicitações com tokens contabilizados.</div> : null}

      {!loading && !error && items.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900">
                <tr><th className="px-4 py-3">Posição</th><th className="px-4 py-3">Solicitação</th><th className="px-4 py-3">Modelo e perfil</th><th className="px-4 py-3">Execução</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Tokens</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                {items.map((item, index) => (
                  <tr key={item.id} className="transition hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20">
                    <td className="px-4 py-4"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-full font-bold ${index < 3 ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{index + 1}</span></td>
                    <td className="px-4 py-4"><Link to={`/codex/requests/${item.id}`} className="font-bold text-emerald-700 hover:underline dark:text-emerald-400">#{item.id}</Link><div className="mt-1 max-w-xs truncate text-sm text-slate-600 dark:text-slate-400" title={item.environment}>{item.environment}</div><div className="mt-1 text-xs text-slate-400">{dateFormatter.format(new Date(item.createdAt))}</div></td>
                    <td className="px-4 py-4 text-sm"><div className="font-medium text-slate-800 dark:text-slate-100">{item.model}</div><div className="mt-1 text-xs text-slate-500">{item.profile ?? 'Sem perfil'}</div></td>
                    <td className="px-4 py-4 text-sm"><div className="font-medium text-slate-800 dark:text-slate-100">{formatDuration(item.durationMs)}</div><div className="mt-1 text-xs text-slate-500">Raciocínio: {item.reasoningEffort.toUpperCase()}</div></td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[item.status]}`}>{statusLabel[item.status]}</span></td>
                    <td className="px-4 py-4 text-right"><div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{numberFormatter.format(item.totalTokens)}</div><div className="mt-1 text-xs tabular-nums text-slate-500">entrada {numberFormatter.format(item.promptTokens ?? 0)} · cache {numberFormatter.format(item.cachedPromptTokens ?? 0)} · saída {numberFormatter.format(item.completionTokens ?? 0)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
