import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';

interface ChatgptAccountStatus {
  connected: boolean;
  status?: string;
  accountEmail?: string | null;
  expiresAt?: string | null;
}

const parseStatus = (payload: unknown): ChatgptAccountStatus => {
  if (!payload || typeof payload !== 'object') {
    return { connected: false, status: 'disconnected' };
  }

  const record = payload as Record<string, unknown>;
  const connected = Boolean(record.connected);
  const status = typeof record.status === 'string' ? record.status : connected ? 'connected' : 'disconnected';
  const accountEmail = typeof record.accountEmail === 'string' ? record.accountEmail : null;
  const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : null;

  return {
    connected,
    status,
    accountEmail,
    expiresAt
  };
};

export default function CodexChatgptPage() {
  const [account, setAccount] = useState<ChatgptAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.get('/account/read');
      setAccount(parseStatus(response.data));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setAccount({ connected: false, status: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccount().catch(() => undefined);
  }, [loadAccount]);

  const handleConnect = useCallback(async () => {
    setActionLoading(true);
    try {
      const response = await client.post('/account/login/start');
      const authUrl = response.data?.url || response.data?.authUrl;
      if (typeof authUrl === 'string' && authUrl.length > 0) {
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      }
      await loadAccount();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [loadAccount]);

  const handleLogout = useCallback(async () => {
    setActionLoading(true);
    try {
      await client.post('/account/logout');
      await loadAccount();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [loadAccount]);

  const isConnected = Boolean(account?.connected);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Codex ChatGPT Managed</h2>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-4">
        <h3 className="text-lg font-semibold">Estado da conta</h3>
        {loading ? <p className="text-sm text-slate-500">Carregando status...</p> : null}
        {!loading && account ? (
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">Status:</span> {account.status ?? (isConnected ? 'connected' : 'disconnected')}</p>
            <p><span className="font-medium">Conectado:</span> {isConnected ? 'Sim' : 'Não'}</p>
            <p><span className="font-medium">Conta:</span> {account.accountEmail || 'não informada'}</p>
            <p>
              <span className="font-medium">Validade:</span>{' '}
              {account.expiresAt ? new Date(account.expiresAt).toLocaleString('pt-BR') : 'não informada'}
            </p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleConnect}
            disabled={actionLoading}
            className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Conectar com ChatGPT
          </button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={actionLoading || !isConnected}
            className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Desconectar
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5">
        <h3 className="text-lg font-semibold">Execução</h3>
        {isConnected ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-2">
            Conta conectada. Nesta fase MVP, o bloqueio de autenticação já está habilitado e a integração de execução completa entra na fase 2.
          </p>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
            Bloqueado: conecte sua conta no fluxo ChatGPT managed para habilitar uso desta área.
          </p>
        )}
      </div>
    </section>
  );
}
