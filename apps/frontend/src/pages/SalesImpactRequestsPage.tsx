import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { formatDateTime } from '../lib/codex';

interface SalesImpactRequest {
  id: number;
  title: string;
  createdAt: string;
}

interface SalesImpactPage {
  content: SalesImpactRequest[];
  number: number;
  totalPages: number;
  totalElements: number;
  first: boolean;
  last: boolean;
}

const PAGE_SIZE = 25;

export default function SalesImpactRequestsPage() {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SalesImpactPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client.get<SalesImpactPage>('/codex/requests/sales-impact/5', { params: { page, size: PAGE_SIZE } })
      .then((response) => setResult(response.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Solicitações com nota 5 em vendas</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Solicitações do Codex ChatGPT MKT classificadas com impacto estimado muito alto em vendas.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-sm text-slate-500 dark:border-slate-800">
          {result ? `${result.totalElements.toLocaleString('pt-BR')} solicitação(ões) encontrada(s)` : 'Consultando solicitações...'}
        </div>
        {loading ? <p className="p-6 text-sm text-slate-500">Carregando página...</p> : null}
        {error ? <p className="m-5 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p> : null}
        {!loading && !error && result?.content.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">Nenhuma solicitação com nota 5 foi encontrada.</p>
        ) : null}
        {!loading && !error && result?.content.length ? (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {result.content.map((request) => (
              <li key={request.id}>
                <Link to={`/codex/requests/${request.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{request.title}</p>
                    <p className="mt-1 text-xs text-slate-500">Solicitação #{request.id} · {formatDateTime(request.createdAt)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-emerald-700 dark:text-emerald-300">Ver detalhes →</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {result && result.totalPages > 1 ? (
        <nav aria-label="Paginação das solicitações com nota 5" className="flex items-center justify-between gap-4">
          <button type="button" disabled={result.first || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700">Anterior</button>
          <p className="text-sm text-slate-600 dark:text-slate-300">Página {result.number + 1} de {result.totalPages}</p>
          <button type="button" disabled={result.last || loading} onClick={() => setPage((current) => current + 1)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700">Próxima</button>
        </nav>
      ) : null}
    </section>
  );
}
