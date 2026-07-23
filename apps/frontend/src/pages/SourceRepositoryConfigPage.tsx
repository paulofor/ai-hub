import { FormEvent, useEffect, useState } from 'react';
import client from '../api/client';

interface SourceRepositoryConfig {
  owner: string;
  repo: string;
  branch: string;
  tokenConfigured: boolean;
  updatedAt?: string | null;
}

const FIXED_OWNER = 'paulofor';
const FIXED_REPO = 'ai-hub';
const FIXED_BRANCH = 'main';

export default function SourceRepositoryConfigPage() {
  const [token, setToken] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    client
      .get<SourceRepositoryConfig>('/source-repository-config')
      .then((response) => {
        setTokenConfigured(response.data.tokenConfigured);
        setUpdatedAt(response.data.updatedAt ?? null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!tokenConfigured && !token.trim()) {
      setError('Cole o token do GitHub antes de salvar.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await client.put<SourceRepositoryConfig>('/source-repository-config', {
        owner: FIXED_OWNER,
        repo: FIXED_REPO,
        branch: FIXED_BRANCH,
        token: token.trim() || undefined
      });
      setToken('');
      setTokenConfigured(response.data.tokenConfigured);
      setUpdatedAt(response.data.updatedAt ?? null);
      setSuccess('Configuração salva. A dashboard já pode consultar as datas pelo GitHub.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Configuração do Repositório</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Configure a origem usada pela dashboard para calcular a última alteração dos módulos.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {loading ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Carregando configuração...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  Usuário ou organização
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{FIXED_OWNER}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Repositório</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{FIXED_REPO}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Branch</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{FIXED_BRANCH}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="source-token" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Token GitHub
              </label>
              <input
                id="source-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                placeholder={tokenConfigured ? 'Token já salvo. Preencha apenas para trocar.' : 'Cole o token GitHub'}
                autoComplete="off"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tokenConfigured
                  ? 'Há um token salvo no banco. Ele não é exibido de volta por segurança.'
                  : 'Nenhum token salvo ainda.'}
              </p>
            </div>

            {updatedAt && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Última atualização: {new Date(updatedAt).toLocaleString('pt-BR')}
              </p>
            )}

            {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {success && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? 'Salvando...' : 'Salvar configuração'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
