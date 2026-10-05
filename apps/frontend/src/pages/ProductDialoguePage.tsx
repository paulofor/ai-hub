import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import client from '../api/client';
import CodexResponseBody from '../components/CodexResponseBody';
import { CodexStatus, codexStatusStyles, formatDateTime, formatStatus } from '../lib/codex';

interface ProductDialogueRequest {
  id: number;
  status: CodexStatus;
  userMessage?: string | null;
  responseText?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}

const buttonClass = 'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700';

function responsePlaceholder(request: ProductDialogueRequest) {
  switch (request.status) {
    case 'PENDING': return 'Aguardando início da execução.';
    case 'RUNNING': return 'Aguardando resposta do modelo…';
    case 'FAILED': return 'A execução falhou. Abra os detalhes da solicitação para mais informações.';
    case 'CANCELLED': return 'Solicitação cancelada. Nenhuma nova resposta será gerada.';
    default: return 'Resposta do modelo indisponível.';
  }
}

export default function ProductDialoguePage() {
  const [params] = useSearchParams();
  const productName = params.get('productName') ?? '';
  const validProduct = Boolean(productName.trim()) && productName.length <= 150;
  const [requests, setRequests] = useState<ProductDialogueRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRequests([]);
    setError('');
    if (!validProduct) {
      setLoading(false);
      return;
    }
    setLoading(true);
    client.get<ProductDialogueRequest[]>('/codex/requests/marketing-products/dialogue', {
      params: { productName }, signal: controller.signal
    }).then((response) => { if (!controller.signal.aborted) setRequests(response.data); })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível carregar o diálogo deste produto.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productName, validProduct, reload]);

  return (
    <section className="space-y-6">
      <header className="space-y-3">
        <Link to="/codex-chatgpt-mkt/produtos" className="text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400">← Voltar à evolução dos produtos</Link>
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Codex ChatGPT MKT</p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold">Diálogo do produto</h2>
            {validProduct ? <h3 className="mt-2 break-words text-xl font-semibold">{productName}</h3> : null}
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">As 4 solicitações mais recentes deste produto, da mais antiga para a mais nova, com a solicitação e a resposta do modelo.</p>
            <p className="mt-1 text-xs text-slate-500">Horários de Brasília.</p>
          </div>
          {validProduct ? <button type="button" disabled={loading} className={buttonClass} onClick={() => setReload((value) => value + 1)}>Atualizar diálogo</button> : null}
        </div>
      </header>
      {!validProduct ? <p role="alert" className="rounded-xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-950">Selecione um produto na tela de evolução dos produtos para abrir o diálogo.</p> : <>
        {loading ? <p role="status" className="rounded-xl border bg-white p-6 text-slate-500 dark:border-slate-800 dark:bg-slate-950">Carregando diálogo…</p> : null}
        {error ? <div role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error} <button type="button" className="font-semibold underline" onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div> : null}
        {!loading && !error && requests.length === 0 ? <p className="rounded-xl border bg-white p-6 text-slate-500 dark:border-slate-800 dark:bg-slate-950">Este produto ainda não tem solicitações no perfil Codex ChatGPT MKT.</p> : null}
        {!loading && !error && requests.length > 0 ? <div role="region" aria-label={`Diálogo de ${productName}`} className="space-y-6 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          {requests.map((request) => <article key={request.id} aria-label={`Solicitação #${request.id}`} className="min-w-0 space-y-3">
            <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link to={`/codex/requests/${request.id}`} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Solicitação #{request.id}</Link>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${codexStatusStyles[request.status]}`}>{formatStatus(request.status)}</span>
            </header>
            <div role="region" aria-label={`Usuário da solicitação #${request.id}`} className="ml-auto max-w-3xl rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Usuário · <time dateTime={request.createdAt}>{formatDateTime(request.createdAt)}</time></p>
              <p className="whitespace-pre-wrap break-words">{request.userMessage?.trim() || 'Mensagem original indisponível.'}</p>
            </div>
            <div role="region" aria-label={`Modelo da solicitação #${request.id}`} className="mr-auto min-w-0 max-w-3xl rounded-lg bg-white px-3 py-2 text-sm text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Modelo{request.finishedAt ? <> · <time dateTime={request.finishedAt}>{formatDateTime(request.finishedAt)}</time></> : null}</p>
              {request.responseText?.trim() ? <CodexResponseBody content={request.responseText} /> : <p>{responsePlaceholder(request)}</p>}
            </div>
          </article>)}
        </div> : null}
      </>}
    </section>
  );
}
