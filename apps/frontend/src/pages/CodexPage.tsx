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

interface EnvironmentOption {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

interface RepositoryFileView {
  path: string;
  ref: string;
  sha: string | null;
  size: number;
  content: string | null;
}

export default function CodexPage() {
  const [prompt, setPrompt] = useState('');
  const [environment, setEnvironment] = useState('');
  const [requests, setRequests] = useState<CodexRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [environmentOptions, setEnvironmentOptions] = useState<EnvironmentOption[]>([]);
  const [fileEnvironment, setFileEnvironment] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileRef, setFileRef] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileResult, setFileResult] = useState<RepositoryFileView | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    client
      .get<CodexRequest[]>('/codex/requests')
      .then((response) => setRequests(response.data))
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
        setFileEnvironment((current) => {
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
      const response = await client.post<CodexRequest>('/codex/requests', {
        prompt: trimmedPrompt,
        environment: trimmedEnvironment
      });
      setRequests((prev) => [response.data, ...prev]);
      setPrompt('');
      setEnvironment(trimmedEnvironment);
      setSuccessMessage('Solicitação enviada para o Codex.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchFile = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedEnvironment = fileEnvironment.trim();
    const trimmedPath = filePath.trim();
    const trimmedRef = fileRef.trim();

    if (!trimmedEnvironment || !trimmedPath) {
      setFileError('Informe o ambiente e o caminho completo do arquivo.');
      return;
    }

    setFileLoading(true);
    setFileError(null);
    setCopyMessage(null);

    try {
      const params: Record<string, string> = {
        environment: trimmedEnvironment,
        path: trimmedPath
      };
      if (trimmedRef) {
        params.ref = trimmedRef;
      }
      const response = await client.get<RepositoryFileView>('/repositories/file', { params });
      setFileResult(response.data);
    } catch (err) {
      setFileResult(null);
      setFileError((err as Error).message);
    } finally {
      setFileLoading(false);
    }
  };

  const handleCopyContent = async () => {
    if (!fileResult?.content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fileResult.content);
      setCopyMessage('Conteúdo copiado para a área de transferência.');
      setTimeout(() => setCopyMessage(null), 2000);
    } catch (err) {
      setCopyMessage('Não foi possível copiar o conteúdo.');
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

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-4 space-y-1">
          <h3 className="text-lg font-semibold">Consultar arquivo do repositório</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Use esta ferramenta quando o Codex solicitar o conteúdo de um arquivo específico do ambiente selecionado.
          </p>
        </div>
        <form onSubmit={handleFetchFile} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label htmlFor="file-environment" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Ambiente
              </label>
              <select
                id="file-environment"
                value={fileEnvironment}
                onChange={(event) => setFileEnvironment(event.target.value)}
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
            <div className="flex flex-col gap-2 md:col-span-2">
              <label htmlFor="file-path" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Caminho do arquivo
              </label>
              <input
                id="file-path"
                type="text"
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                placeholder="ex.: backend/ads-service/src/main/java/.../JourneyStep.java"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label htmlFor="file-ref" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Branch ou commit (opcional)
              </label>
              <input
                id="file-ref"
                type="text"
                value={fileRef}
                onChange={(event) => setFileRef(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                placeholder="main"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={fileLoading || environmentOptions.length === 0}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {fileLoading ? 'Buscando...' : 'Buscar arquivo'}
              </button>
            </div>
          </div>
          {fileError && <p className="text-sm text-red-500">{fileError}</p>}
        </form>

        {fileResult && (
          <div className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-white/70 p-4 text-sm dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-semibold">{fileResult.path}</span>
              <span className="text-slate-500">ref: {fileResult.ref}</span>
              {fileResult.sha && <span className="text-slate-500">sha: {fileResult.sha}</span>}
              <span className="text-slate-500">
                tamanho: {new Intl.NumberFormat('pt-BR').format(fileResult.size)} bytes
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopyContent}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Copiar conteúdo
              </button>
              {copyMessage && <span className="text-xs text-slate-500">{copyMessage}</span>}
            </div>
            <textarea
              readOnly
              value={fileResult.content ?? ''}
              className="h-64 w-full resize-y rounded-md border border-slate-200 bg-slate-950/90 p-3 font-mono text-xs text-emerald-100 dark:border-slate-800"
            />
          </div>
        )}
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
