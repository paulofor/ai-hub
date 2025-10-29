import { FormEvent, useState } from 'react';
import { CodexSubmissionResponse, submitCodexRequest } from '../api/codex';

const environments = [
  { value: 'master', label: 'master' },
  { value: 'staging', label: 'staging' },
  { value: 'production', label: 'production' }
];

export default function CodexPage() {
  const [prompt, setPrompt] = useState('');
  const [environment, setEnvironment] = useState(environments[0]?.value ?? 'master');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CodexSubmissionResponse | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) {
      setError('Descreva a tarefa que deseja enviar para o Codex.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await submitCodexRequest({ prompt: prompt.trim(), environment });
      setResult(response);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o prompt.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Codex</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Descreva o que devemos codificar a seguir e envie para o Codex executar.
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="codex-prompt" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Descreva uma tarefa
            </label>
            <textarea
              id="codex-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ex.: Criar um serviço para calcular métricas de deploy"
              className="min-h-[140px] w-full rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-800 shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="codex-environment">
              Ambiente
            </label>
            <select
              id="codex-environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-48"
            >
              {environments.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {loading ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Resposta do Codex</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ambiente: <span className="font-semibold text-slate-700 dark:text-slate-200">{result.environment}</span>
          </p>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-200">Prompt enviado</h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-slate-700 dark:bg-slate-900 dark:text-slate-100">
                {result.prompt}
              </p>
            </div>
            {result.response && (
              <div>
                <h3 className="font-medium text-slate-700 dark:text-slate-200">Retorno</h3>
                <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-slate-950/90 p-3 text-xs text-emerald-100">
                  {result.response}
                </pre>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
