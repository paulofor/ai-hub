import { FormEvent, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

interface Environment {
  id: number;
  name: string;
  description?: string | null;
  createdAt: string;
}

export default function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    client
      .get<Environment[]>('/environments')
      .then((response) => setEnvironments(response.data))
      .catch((err: Error) => setError(err.message));
  }, []);

  const sortedEnvironments = useMemo(() => {
    return [...environments].sort((a, b) => a.name.localeCompare(b.name));
  }, [environments]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      setError('Informe um nome para o ambiente.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await client.post<Environment>('/environments', {
        name: trimmedName,
        description: trimmedDescription || undefined
      });
      setEnvironments((prev) => [...prev, response.data]);
      setName('');
      setDescription('');
      setSuccessMessage('Ambiente cadastrado com sucesso.');
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
          <h2 className="text-2xl font-semibold">Ambientes</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Cadastre e organize os ambientes disponíveis para os fluxos da plataforma.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="environment-name" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Nome do ambiente
            </label>
            <input
              id="environment-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              placeholder="Ex.: produção"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="environment-description" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Descrição (opcional)
            </label>
            <textarea
              id="environment-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="h-24 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-900"
              placeholder="Inclua informações adicionais, como URL, cluster ou responsável."
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? 'Salvando...' : 'Cadastrar ambiente'}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
            {successMessage && <span className="text-sm text-emerald-600">{successMessage}</span>}
          </div>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Ambientes cadastrados</h3>
        <div className="rounded-xl border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Nome</th>
                <th className="px-4 py-3 text-left font-semibold">Descrição</th>
                <th className="px-4 py-3 text-left font-semibold">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sortedEnvironments.map((environment) => (
                <tr key={environment.id}>
                  <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-100">{environment.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {environment.description ? (
                      <p className="whitespace-pre-line">{environment.description}</p>
                    ) : (
                      <span className="text-slate-400">Sem descrição</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                    {new Date(environment.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {sortedEnvironments.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-center text-slate-500" colSpan={3}>
                    Nenhum ambiente cadastrado até o momento.
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
