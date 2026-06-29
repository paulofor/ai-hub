import { FormEvent, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

interface PromptListItem {
  id: number;
  position: number;
  prompt: string;
}

interface PromptList {
  id: number;
  name: string;
  sourceFilename: string;
  createdAt: string;
  itemCount: number;
  items: PromptListItem[];
}

export default function PromptListsPage() {
  const [promptLists, setPromptLists] = useState<PromptList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const totalPrompts = useMemo(
    () => promptLists.reduce((total, list) => total + list.itemCount, 0),
    [promptLists]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .get<PromptList[]>('/prompt-lists')
      .then((response) => setPromptLists(response.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError('Selecione um arquivo .md para criar a lista de prompts.');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('O arquivo selecionado precisa ter extensão .md.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    if (name.trim()) {
      formData.append('name', name.trim());
    }

    setSaving(true);
    try {
      const response = await client.post<PromptList>('/prompt-lists', formData);
      setPromptLists((prev) => [response.data, ...prev.filter((list) => list.id !== response.data.id)]);
      setName('');
      setFile(null);
      const input = document.getElementById('prompt-list-file') as HTMLInputElement | null;
      if (input) {
        input.value = '';
      }
      setSuccess(`Lista salva com ${response.data.itemCount} prompt(s). Prompts anteriores da mesma lista foram substituídos.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Lista de Prompts</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Importe arquivos Markdown com itens iniciados por <code>*</code>. Ao reenviar um arquivo para uma lista de mesmo nome, os prompts antigos são apagados e reconstruídos.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <p>Listas: {promptLists.length}</p>
          <p>Prompts: {totalPrompts}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <h3 className="mb-4 text-lg font-semibold">Criar ou atualizar lista</h3>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="flex flex-col gap-2">
            <label htmlFor="prompt-list-name" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Nome da lista (opcional)
            </label>
            <input
              id="prompt-list-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              placeholder="Ex.: Prompts de revisão"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="prompt-list-file" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Arquivo Markdown (.md)
            </label>
            <input
              id="prompt-list-file"
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? 'Importando...' : 'Salvar lista'}
          </button>
        </form>
        {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
        {success && <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{success}</p>}
      </div>

      <div className="space-y-4">
        {loading && <p className="text-sm text-slate-500">Carregando listas...</p>}
        {!loading && promptLists.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            Nenhuma lista cadastrada ainda. Importe um arquivo .md para começar.
          </div>
        )}
        {promptLists.map((list) => (
          <article key={list.id} className="rounded-xl border border-slate-200 bg-white/70 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{list.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {list.itemCount} prompt(s) · {list.sourceFilename} · {new Date(list.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
            <ol className="mt-4 space-y-2">
              {list.items.map((item) => (
                <li key={item.id} className="rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-950/50 dark:text-slate-200">
                  <span className="mr-2 font-semibold text-emerald-700 dark:text-emerald-300">#{item.position}</span>
                  {item.prompt}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
