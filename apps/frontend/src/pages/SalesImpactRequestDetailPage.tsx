import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../api/client';
import CodexResponseBody from '../components/CodexResponseBody';
import {
  CodexRequest,
  codexStatusStyles,
  formatDateTime,
  formatDuration,
  formatStatus,
  formatTokens,
  parseCodexRequest
} from '../lib/codex';

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
  </div>
);

export default function SalesImpactRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [request, setRequest] = useState<CodexRequest | null>(null);
  const [olderId, setOlderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [requestResponse, olderResponse] = await Promise.all([
        client.get(`/codex/requests/${id}`),
        client.get(`/codex/requests/sales-impact/5/${id}/previous`).catch(() => null)
      ]);
      const parsed = parseCodexRequest(requestResponse.data);
      if (!parsed) throw new Error('Não foi possível carregar a solicitação.');
      setRequest(parsed);
      const candidate = Number(olderResponse?.data?.id);
      setOlderId(Number.isFinite(candidate) ? candidate : null);
    } catch (err) {
      setError((err as Error).message);
      setRequest(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="py-12 text-center text-sm text-slate-500">Carregando solicitação...</p>;

  if (!request) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        <p>{error ?? 'Solicitação não encontrada.'}</p>
        <Link className="mt-3 inline-block font-semibold underline" to="/codex-chatgpt-mkt/nota-5-vendas">Voltar para a lista</Link>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/codex-chatgpt-mkt/nota-5-vendas" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300">← Nota 5 em Vendas</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">Solicitação #{request.id}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${codexStatusStyles[request.status]}`}>{formatStatus(request.status)}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={!olderId}
          onClick={() => navigate(`/codex-chatgpt-mkt/nota-5-vendas/${olderId}`)}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {olderId ? 'Próxima (mais antiga) →' : 'Não há solicitação mais antiga'}
        </button>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Métricas da solicitação">
        <Metric label="Tempo" value={formatDuration(request.durationMs)} />
        <Metric label="Tokens de entrada" value={formatTokens(request.promptTokens)} />
        <Metric label="Tokens de saída" value={formatTokens(request.completionTokens)} />
        <Metric label="Hora de início" value={formatDateTime(request.startedAt ?? request.createdAt)} />
        <Metric label="Hora de fim" value={formatDateTime(request.finishedAt)} />
      </dl>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">Diálogo</div>
        <div className="space-y-8 px-4 py-7 sm:px-8">
          <article className="ml-auto max-w-3xl">
            <p className="mb-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Você</p>
            <div className="rounded-3xl rounded-br-md bg-slate-100 px-5 py-4 text-sm leading-7 text-slate-800 dark:bg-slate-800 dark:text-slate-100 whitespace-pre-wrap">{request.prompt}</div>
          </article>
          <article className="max-w-4xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">AI</span>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Codex ChatGPT MKT</p>
            </div>
            <div className="text-sm leading-7 text-slate-800 dark:text-slate-100">
              {request.responseText ? <CodexResponseBody content={request.responseText} /> : <p className="italic text-slate-500">A resposta ainda não está disponível.</p>}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
