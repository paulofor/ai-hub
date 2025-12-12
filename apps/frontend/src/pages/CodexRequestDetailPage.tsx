import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import client from '../api/client';
import {
  CodexRequest,
  codexStatusStyles,
  formatCost,
  formatDateTime,
  formatDuration,
  formatProfile,
  formatStatus,
  formatTokens,
  isTerminalStatus,
  parseCodexRequest
} from '../lib/codex';

export default function CodexRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<CodexRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentDirty, setCommentDirty] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const commentDirtyRef = useRef(false);

  useEffect(() => {
    commentDirtyRef.current = commentDirty;
  }, [commentDirty]);

  const fetchRequest = useCallback(
    async (silent = false) => {
      if (!id) {
        setError('ID da solicitação inválido.');
        setLoading(false);
        return;
      }

      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const response = await client.get(`/codex/requests/${id}`);
        const parsed = parseCodexRequest(response.data);
        if (!parsed) {
          throw new Error('Não foi possível carregar a solicitação.');
        }
        setRequest(parsed);
        if (!commentDirtyRef.current) {
          setComment(parsed.userComment ?? '');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [id]
  );

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  useEffect(() => {
    if (!request || isTerminalStatus(request.status)) {
      return undefined;
    }
    const interval = setInterval(() => {
      fetchRequest(true).catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchRequest, request]);

  const statusBadge = useMemo(() => {
    if (!request) return null;
    return (
      <span
        className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${codexStatusStyles[request.status]}`}
      >
        {formatStatus(request.status)}
      </span>
    );
  }, [request]);

  const handleSaveComment = useCallback(async () => {
    if (!request) return;
    setSavingComment(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await client.post(`/codex/requests/${request.id}/comment`, { comment });
      const parsed = parseCodexRequest(response.data);
      if (!parsed) {
        throw new Error('Não foi possível salvar o comentário.');
      }
      setRequest(parsed);
      setComment(parsed.userComment ?? '');
      setCommentDirty(false);
      setSuccessMessage('Comentário salvo com sucesso.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingComment(false);
    }
  }, [comment, request]);

  const handleRating = useCallback(
    async (rating: number) => {
      if (!request) return;
      setSavingRating(true);
      setError(null);
      setSuccessMessage(null);
      try {
        const response = await client.post(`/codex/requests/${request.id}/rating`, { rating });
        const parsed = parseCodexRequest(response.data);
        if (parsed) {
          setRequest(parsed);
          setSuccessMessage('Avaliação registrada.');
        } else {
          await fetchRequest();
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSavingRating(false);
      }
    },
    [fetchRequest, request]
  );

  const ratingStars = useMemo(() => {
    if (!request) return null;
    const currentRating = request.rating ?? 0;
    const isInteractive = request.status === 'COMPLETED';
    if (!isInteractive && currentRating === 0) {
      return <span className="text-slate-500">Sem avaliação</span>;
    }
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = value <= currentRating;
          if (!isInteractive) {
            return (
              <span key={`static-${value}`} className={`text-xl ${filled ? 'text-amber-500' : 'text-slate-400'}`}>
                ★
              </span>
            );
          }
          return (
            <button
              key={`rate-${value}`}
              type="button"
              onClick={() => handleRating(value)}
              disabled={savingRating}
              className="text-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              title={`Avaliar como ${value}`}
            >
              <span className={filled ? 'text-amber-500' : 'text-slate-400'}>★</span>
            </button>
          );
        })}
      </div>
    );
  }, [handleRating, request, savingRating]);

  if (!loading && !request) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Solicitação não encontrada.</p>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <Link to="/codex" className="text-emerald-600 hover:underline">
            Voltar para histórico
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold">Detalhe da solicitação</h2>
            {statusBadge}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">Veja o prompt, a resposta, o merge e registre melhorias.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fetchRequest()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={loading}
          >
            Atualizar
          </button>
          <Link
            to="/codex"
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Voltar
          </Link>
        </div>
      </div>

      {(error || successMessage) && (
        <div className="space-y-2">
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200">{error}</div>}
          {successMessage && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200">
              {successMessage}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {loading && <p className="text-sm text-slate-500">Carregando solicitação...</p>}
        {request && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Solicitação #{request.id}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Criada em {formatDateTime(request.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Perfil: <strong>{formatProfile(request.profile)}</strong>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Modelo: <strong>{request.model}</strong>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Ambiente: <strong>{request.environment}</strong>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem label="Início" value={formatDateTime(request.startedAt ?? request.createdAt)} />
              <InfoItem label="Fim" value={formatDateTime(request.finishedAt)} />
              <InfoItem label="Duração" value={formatDuration(request.durationMs)} />
              <InfoItem label="Timeouts" value={(request.timeoutCount ?? 0).toLocaleString('pt-BR')} />
              <InfoItem label="HTTP GETs" value={(request.httpGetCount ?? 0).toLocaleString('pt-BR')} />
              <InfoItem
                label="Job no sandbox"
                value={request.externalId ? `ID ${request.externalId}` : '—'}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Uso de tokens</h4>
                <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <InfoRow label="Input" value={formatTokens(request.promptTokens)} />
                  <InfoRow label="Input cacheado" value={formatTokens(request.cachedPromptTokens)} />
                  <InfoRow label="Output" value={formatTokens(request.completionTokens)} />
                  <InfoRow label="Total" value={formatTokens(request.totalTokens)} bold />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Custos</h4>
                <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <InfoRow label="Input" value={formatCost(request.promptCost, 4)} />
                  <InfoRow label="Input cacheado" value={formatCost(request.cachedPromptCost, 4)} />
                  <InfoRow label="Output" value={formatCost(request.completionCost, 4)} />
                  <InfoRow label="Total" value={formatCost(request.cost)} bold />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Prompt enviado</h4>
                  <span className="text-xs text-slate-500">{request.prompt.length.toLocaleString('pt-BR')} caracteres</span>
                </div>
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-900/90 p-4 text-xs leading-relaxed text-emerald-100">
                  {request.prompt}
                </pre>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Resposta do Codex</h4>
                  <span className="text-xs text-slate-500">
                    {request.responseText ? `${request.responseText.length.toLocaleString('pt-BR')} caracteres` : 'Sem resposta'}
                  </span>
                </div>
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-900/90 p-4 text-xs leading-relaxed text-emerald-100">
                  {request.responseText ?? '—'}
                </pre>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Merge / Pull Request</h4>
                {request.pullRequestUrl ? (
                  <a
                    href={request.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-2 text-emerald-700 underline hover:text-emerald-800"
                  >
                    Abrir merge/pull request
                    <span aria-hidden>↗</span>
                  </a>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Nenhum link de merge disponível.</p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-2 dark:border-slate-700 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Avaliação</h4>
                  <span className="text-xs text-slate-500">Disponível após conclusão</span>
                </div>
                <div>{ratingStars}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {request && (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Comentário e melhoria</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">Guarde aprendizados para evoluir o processo.</p>
            </div>
            <Link to={`/codex/requests/${request.id}`} className="text-xs text-slate-500">
              Última atualização: {formatDateTime(request.finishedAt ?? request.createdAt)}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            <textarea
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
                setCommentDirty(true);
              }}
              rows={5}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Anote decisões, problemas encontrados ou ideias para melhorar o fluxo."
            />
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <button
                type="button"
                onClick={handleSaveComment}
                disabled={savingComment}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {savingComment ? 'Salvando...' : 'Salvar comentário'}
              </button>
              {commentDirty && <span className="text-amber-600">Alterações não salvas</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-semibold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className={bold ? 'font-semibold text-slate-800 dark:text-slate-100' : ''}>{value}</span>
    </div>
  );
}
