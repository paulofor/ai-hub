import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { CodexStatus, codexStatusStyles, formatCost, formatDateTime, formatDuration, formatTokens } from '../lib/codex';

interface PageResult<T> {
  content: T[];
  number: number;
  totalPages: number;
  totalElements: number;
  first: boolean;
  last: boolean;
}

interface ProductRequest {
  id: number;
  status: CodexStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  processNumber?: string | null;
  processText?: string | null;
  cost?: number | null;
  totalTokens?: number | null;
}

interface ProductHistory {
  productName: string;
  requestCount: number;
  latestRequestAt?: string | null;
  requests: PageResult<ProductRequest>;
}

const PAGE_SIZE = 15;
const endpoint = '/codex/requests/marketing-products';
const statusLabel: Record<CodexStatus, string> = {
  PENDING: 'Pendente', RUNNING: 'Em execução', COMPLETED: 'Concluída', FAILED: 'Falhou', CANCELLED: 'Cancelada'
};
const buttonClass = 'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700';

function Pagination({ result, loading, label, onChange }: {
  result: PageResult<unknown>;
  loading: boolean;
  label: string;
  onChange: (page: number) => void;
}) {
  if (result.totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" disabled={result.first || loading} onClick={() => onChange(result.number - 1)} className={buttonClass}>Anterior</button>
      <p className="text-sm text-slate-600 dark:text-slate-300">Página {result.number + 1} de {result.totalPages}</p>
      <button type="button" disabled={result.last || loading} onClick={() => onChange(result.number + 1)} className={buttonClass}>Próxima</button>
    </nav>
  );
}

function ProductCard({ product }: { product: ProductHistory }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(product.requests);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (page === 0 && reload === 0) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    client.get<PageResult<ProductRequest>>(`${endpoint}/requests`, {
      params: { productName: product.productName, page, size: PAGE_SIZE }, signal: controller.signal
    }).then((response) => setResult(response.data))
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível carregar as solicitações deste produto.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, product.productName, reload]);

  const changePage = (next: number) => {
    if (next === 0 && reload === 0) {
      setResult(product.requests);
      setError('');
      setLoading(false);
    }
    setPage(next);
  };

  return (
    <article aria-label={`Produto ${product.productName}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="break-words text-xl font-semibold">{product.productName}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{product.requestCount.toLocaleString('pt-BR')} solicitações MKT</p>
          <Link to={`/codex-chatgpt-mkt/produtos/dialogo?${new URLSearchParams({ productName: product.productName })}`} aria-label={`Ver diálogo de ${product.productName}`} className="mt-3 inline-block rounded-md border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950">Ver diálogo</Link>
        </div>
        {product.latestRequestAt ? <p className="text-xs text-slate-500 dark:text-slate-400">Última solicitação: {formatDateTime(product.latestRequestAt)}</p> : null}
      </header>
      {loading ? <p role="status" className="p-5 text-sm text-slate-500">Carregando solicitações…</p> : null}
      {error ? <div role="alert" className="m-5 rounded-md bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error} <button type="button" className="font-semibold underline" onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div> : null}
      {!loading && !error && result.content.length === 0 ? <p className="p-6 text-sm text-slate-500">Este produto ainda não tem solicitações no perfil Codex ChatGPT MKT.</p> : null}
      {!loading && !error && result.content.length > 0 ? (
        <div className="overflow-x-auto" role="region" aria-label={`Histórico de ${product.productName}`} tabIndex={0}>
          <table className="w-full min-w-[950px] divide-y divide-slate-200 dark:divide-slate-800">
            <caption className="sr-only">Solicitações MKT de {product.productName}, da mais recente para a mais antiga</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900"><tr>
              <th scope="col" className="px-4 py-3">Solicitação</th><th scope="col" className="px-4 py-3">Data/hora de execução</th>
              <th scope="col" className="px-4 py-3">Tempo gasto</th><th scope="col" className="px-4 py-3">Processo</th>
              <th scope="col" className="px-4 py-3 text-right">Custo estimado (USD)</th><th scope="col" className="px-4 py-3 text-right">Tokens</th><th scope="col" className="px-4 py-3">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{result.content.map((request) => {
              const active = request.status === 'PENDING' || request.status === 'RUNNING';
              return <tr key={request.id} className="align-top hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                <td className="px-4 py-4"><Link to={`/codex/requests/${request.id}`} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">#{request.id}</Link><p className="mt-1 text-xs text-slate-500">Criada: <time dateTime={request.createdAt}>{formatDateTime(request.createdAt)}</time></p></td>
                <td className="whitespace-nowrap px-4 py-4"><p>Início: {request.startedAt ? <time dateTime={request.startedAt}>{formatDateTime(request.startedAt)}</time> : active ? 'Aguardando início' : 'Não informado'}</p><p className="mt-1 text-xs text-slate-500">Término: {request.finishedAt ? <time dateTime={request.finishedAt}>{formatDateTime(request.finishedAt)}</time> : active ? 'Aguardando término' : 'Não informado'}</p></td>
                <td className="whitespace-nowrap px-4 py-4 tabular-nums">{request.durationMs == null ? 'Não informado' : formatDuration(request.durationMs)}</td>
                <td className="min-w-[180px] max-w-xs px-4 py-4">{request.processNumber ? <><p className="font-semibold">{request.processNumber}</p>{request.processText ? <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{request.processText}</p> : null}</> : <span className="text-slate-500">Sem processo selecionado</span>}</td>
                <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{request.cost == null ? 'Não informado' : formatCost(request.cost)}</td>
                <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{request.totalTokens == null ? 'Não informado' : formatTokens(request.totalTokens)}</td>
                <td className="whitespace-nowrap px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${codexStatusStyles[request.status]}`}>{statusLabel[request.status]}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : null}
      {result.totalPages > 1 ? <footer className="border-t border-slate-200 p-4 dark:border-slate-800"><Pagination result={result} loading={loading} label={`Paginação das solicitações de ${product.productName}`} onChange={changePage} /></footer> : null}
    </article>
  );
}

export default function ProductEvolutionPage() {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PageResult<ProductHistory> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    client.get<PageResult<ProductHistory>>(endpoint, { params: { page, size: PAGE_SIZE }, signal: controller.signal })
      .then((response) => setResult(response.data))
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível carregar a evolução dos produtos.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, reload]);

  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Codex ChatGPT MKT</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-semibold">Evolução dos produtos</h2><p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">Compare os processos registrados em cada atendimento. Produtos e solicitações aparecem do mais recente para o mais antigo, pela data de criação da solicitação.</p><p className="mt-1 text-xs text-slate-500">15 produtos por página e 15 solicitações por card. Horários de Brasília. Nomes históricos são preservados.</p></div><button type="button" disabled={loading} className={buttonClass} onClick={() => setReload((value) => value + 1)}>Atualizar</button></div>
      </header>
      {loading ? <p role="status" className="rounded-xl border bg-white p-6 text-slate-500 dark:border-slate-800 dark:bg-slate-950">Carregando produtos…</p> : null}
      {error ? <div role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error} <button type="button" className="font-semibold underline" onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div> : null}
      {!loading && !error && result ? <>
        <p className="text-sm text-slate-500 dark:text-slate-400">{result.totalElements.toLocaleString('pt-BR')} produtos encontrados</p>
        {result.content.length === 0 ? <p className="rounded-xl border bg-white p-6 text-slate-500 dark:border-slate-800 dark:bg-slate-950">Nenhum produto encontrado. <Link className="font-semibold text-emerald-700 underline dark:text-emerald-400" to="/products">Cadastrar produto</Link></p> : result.content.map((product) => <ProductCard key={`${reload}-${result.number}-${product.productName}`} product={product} />)}
      </> : null}
      {result ? <Pagination result={result} loading={loading} label="Paginação dos produtos" onChange={setPage} /> : null}
    </section>
  );
}
