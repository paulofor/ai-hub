import { FormEvent, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

interface CodexRequest {
  id: number;
  environment: string;
  model: string;
  prompt: string;
  responseText?: string;
  externalId?: string;
  createdAt: string;
}

export default function CodexPage() {
  const [prompt, setPrompt] = useState('');
  const [environment, setEnvironment] = useState('master');
  const [requests, setRequests] = useState<CodexRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    client
      .get<CodexRequest[]>('/codex/requests')
      .then((response) => setRequests(response.data))
      .catch((err: Error) => setError(err.message));
  }, []);

  const sortedRequests = useMemo(() => {
    return [...requests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [requests]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || !environment.trim()) {
      setError('Informe o prompt e o ambiente antes de enviar.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await client.post<CodexRequest>('/codex/requests', {
        prompt,
        environment
      });
      setRequests((prev) => [response.data, ...prev]);
      setPrompt('');
      setSuccessMessage('Solicitação enviada para o Codex.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Codex</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Envie tarefas para o Codex informando o ambiente desejado.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="environment" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Ambiente
            </label>
            <input
              id="environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              placeholder="Ex.: produção"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="prompt" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Descreva uma tarefa
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-32 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-900"
              placeholder="Descreva o que o Codex deve fazer..."
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? 'Enviando...' : 'Enviar para o Codex'}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
            {successMessage && <span className="text-sm text-emerald-600">{successMessage}</span>}
          </div>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Histórico de solicitações</h3>
        <div className="rounded-xl border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Criado em</th>
                <th className="px-4 py-3 text-left font-semibold">Ambiente</th>
                <th className="px-4 py-3 text-left font-semibold">Modelo</th>
                <th className="px-4 py-3 text-left font-semibold">Prompt</th>
                <th className="px-4 py-3 text-left font-semibold">Resposta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sortedRequests.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium">{item.environment}</td>
                  <td className="px-4 py-3">{item.model}</td>
                  <td className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer text-emerald-600">Ver prompt</summary>
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900/90 p-3 text-xs text-emerald-100">
                        {item.prompt}
                      </pre>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    {item.responseText ? (
                      <details>
                        <summary className="cursor-pointer text-emerald-600">Ver resposta</summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900/90 p-3 text-xs text-emerald-100">
                          {item.responseText}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-slate-400">Aguardando retorno</span>
                    )}
                  </td>
                </tr>
              ))}
              {sortedRequests.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-center text-slate-500" colSpan={5}>
                    Nenhuma solicitação registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
