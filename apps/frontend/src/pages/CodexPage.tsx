import { FormEvent, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

type CodexProfile = 'STANDARD' | 'ECONOMY';

interface CodexRequest {
  id: number;
  environment: string;
  model: string;
  profile: CodexProfile;
  prompt: string;
  responseText?: string;
  externalId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  createdAt: string;
}

interface EnvironmentOption {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseProfile = (value: unknown): CodexProfile => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'ECONOMY') {
      return 'ECONOMY';
    }
  }
  return 'STANDARD';
};

const parseCodexRequest = (value: unknown): CodexRequest | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const id = parseNumber(item.id) ?? 0;
  const promptTokens = parseNumber(item.promptTokens);
  const completionTokens = parseNumber(item.completionTokens);
  const totalTokens = parseNumber(item.totalTokens);
  const cost = parseNumber(item.cost);
  const profile = parseProfile(item.profile ?? item.integrationProfile);

  return {
    id,
    environment: (item.environment as string) ?? '',
    model: (item.model as string) ?? '',
    profile,
    prompt: (item.prompt as string) ?? '',
    responseText: (item.responseText as string) ?? undefined,
    externalId: (item.externalId as string) ?? undefined,
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    createdAt: (item.createdAt as string) ?? ''
  };
};

const parseCodexRequests = (payload: unknown): CodexRequest[] => {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { content?: unknown })?.content)
      ? (payload as { content: unknown[] }).content
      : [];

  return items
    .map((item) => parseCodexRequest(item))
    .filter((item): item is CodexRequest => item !== null);
};

const formatTokens = (value?: number) => {
  if (value === undefined || value === null) {
    return '—';
  }
  return value.toLocaleString('pt-BR');
};

const formatCost = (value?: number) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 6,
    maximumFractionDigits: 6
  }).format(value);
};

const formatProfile = (profile: CodexProfile) => {
  switch (profile) {
    case 'ECONOMY':
      return 'Econômico';
    case 'STANDARD':
    default:
      return 'Padrão';
  }
};

export default function CodexPage() {
  const [prompt, setPrompt] = useState('');
  const [environment, setEnvironment] = useState('');
  const [profile, setProfile] = useState<CodexProfile>('STANDARD');
  const [requests, setRequests] = useState<CodexRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [environmentOptions, setEnvironmentOptions] = useState<EnvironmentOption[]>([]);

  useEffect(() => {
    client
      .get('/codex/requests')
      .then((response) => setRequests(parseCodexRequests(response.data)))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    client
      .get<EnvironmentOption[]>('/environments')
      .then((response) => {
        setEnvironmentOptions(response.data);
        setEnvironment((current) => {
          if (current && response.data.some((item) => item.name === current)) {
            return current;
          }
          return response.data[0]?.name ?? '';
        });
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const sortedRequests = useMemo(() => {
    return [...requests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [requests]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    const trimmedEnvironment = environment.trim();

    if (!trimmedPrompt || !trimmedEnvironment) {
      setError('Informe o prompt e o ambiente antes de enviar.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await client.post('/codex/requests', {
        prompt: trimmedPrompt,
        environment: trimmedEnvironment,
        profile
      });
      const parsed = parseCodexRequest(response.data);
      setRequests((prev) => (parsed ? [parsed, ...prev] : prev));
      setPrompt('');
      setEnvironment(trimmedEnvironment);
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
            Envie tarefas para o Codex informando o ambiente desejado e o perfil de uso.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="environment" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Ambiente
            </label>
            <select
              id="environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              disabled={environmentOptions.length === 0}
            >
              {environmentOptions.length === 0 ? (
                <option value="">Nenhum ambiente cadastrado</option>
              ) : (
                environmentOptions.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                    {option.description ? ` — ${option.description}` : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Perfil de integração</span>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="codex-profile"
                  value="STANDARD"
                  checked={profile === 'STANDARD'}
                  onChange={() => setProfile('STANDARD')}
                  className="h-4 w-4"
                />
                <span>
                  Padrão
                  <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                    Máxima autonomia do modelo
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="codex-profile"
                  value="ECONOMY"
                  checked={profile === 'ECONOMY'}
                  onChange={() => setProfile('ECONOMY')}
                  className="h-4 w-4"
                />
                <span>
                  Econômico
                  <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                    Reduz limites de tokens e privilegia execuções enxutas
                  </span>
                </span>
              </label>
            </div>
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
              disabled={loading || environmentOptions.length === 0}
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
                <th className="px-4 py-3 text-left font-semibold">Perfil</th>
                <th className="px-4 py-3 text-left font-semibold">Modelo</th>
                <th className="px-4 py-3 text-left font-semibold">Prompt</th>
                <th className="px-4 py-3 text-left font-semibold">Tokens</th>
                <th className="px-4 py-3 text-left font-semibold">Custo</th>
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
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {formatProfile(item.profile)}
                    </span>
                  </td>
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
                    <div className="space-y-1">
                      <div className="text-slate-600 dark:text-slate-300">
                        Prompt: {formatTokens(item.promptTokens)}
                      </div>
                      <div className="text-slate-600 dark:text-slate-300">
                        Compleção: {formatTokens(item.completionTokens)}
                      </div>
                      <div className="font-medium">Total: {formatTokens(item.totalTokens)}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatCost(item.cost)}</td>
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
                  <td className="px-4 py-4 text-center text-slate-500" colSpan={8}>
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
