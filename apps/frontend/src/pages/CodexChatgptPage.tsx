import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { codexStatusStyles, formatDateTime, formatStatus, isTerminalStatus, parseCodexRequests } from '../lib/codex';

interface ChatgptAccountStatus {
  connected: boolean;
  status?: string;
  accountEmail?: string | null;
  expiresAt?: string | null;
}

interface EnvironmentOption {
  id: number;
  name: string;
}

interface ModelOption {
  id: number;
  modelName: string;
}

const POLL_INTERVAL_MS = 5000;

const parseStatus = (payload: unknown): ChatgptAccountStatus => {
  if (!payload || typeof payload !== 'object') {
    return { connected: false, status: 'disconnected' };
  }
  const record = payload as Record<string, unknown>;
  const connected = Boolean(record.connected);
  const status = typeof record.status === 'string' ? record.status : connected ? 'connected' : 'disconnected';
  const accountEmail = typeof record.accountEmail === 'string' ? record.accountEmail : null;
  const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : null;
  return { connected, status, accountEmail, expiresAt };
};

export default function CodexChatgptPage() {
  const [account, setAccount] = useState<ChatgptAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [environment, setEnvironment] = useState('');
  const [model, setModel] = useState('');
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [requests, setRequests] = useState<ReturnType<typeof parseCodexRequests>>([]);

  const loadAccount = useCallback(async () => {
    const response = await client.get('/account/read');
    setAccount(parseStatus(response.data));
  }, []);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const response = await client.get('/codex/requests', { params: { page: 0, size: 10 } });
      const parsed = parseCodexRequests(response.data).filter((item) => item.profile === 'CHATGPT_CODEX');
      setRequests(parsed);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [accountResponse, envResponse, modelResponse] = await Promise.all([
        client.get('/account/read'),
        client.get<EnvironmentOption[]>('/environments'),
        client.get<ModelOption[]>('/codex/models')
      ]);
      setAccount(parseStatus(accountResponse.data));
      setEnvironments(envResponse.data);
      setModels(modelResponse.data);
      setEnvironment((current) => current || envResponse.data[0]?.name || '');
      setModel((current) => current || modelResponse.data[0]?.modelName || '');
      await loadRequests();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadRequests]);

  useEffect(() => {
    loadBootstrap().catch(() => undefined);
  }, [loadBootstrap]);

  useEffect(() => {
    const interval = setInterval(() => {
      Promise.all([loadAccount(), loadRequests()]).catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAccount, loadRequests]);

  const accountExpired = useMemo(() => {
    if (!account?.expiresAt) {
      return false;
    }
    const expiresAt = new Date(account.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  }, [account]);

  const isConnected = Boolean(account?.connected) && !accountExpired && account?.status !== 'expired';

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

  const handleRun = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isConnected) {
      setError('Conta ChatGPT não conectada ou expirada. Reconecte para executar.');
      return;
    }
    setActionLoading(true);
    try {
      await client.post('/codex/requests', {
        prompt,
        environment,
        model,
        profile: 'CHATGPT_CODEX'
      });
      setPrompt('');
      await loadRequests();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [environment, isConnected, loadRequests, model, prompt]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Codex ChatGPT Managed</h2>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-4">
        <h3 className="text-lg font-semibold">Estado da conta (tempo real)</h3>
        {loading ? <p className="text-sm text-slate-500">Carregando status...</p> : null}
        {account ? <div className="space-y-1 text-sm">
          <p><span className="font-medium">Status:</span> {account.status ?? 'disconnected'}</p>
          <p><span className="font-medium">Conectado:</span> {isConnected ? 'Sim' : 'Não'}</p>
          <p><span className="font-medium">Conta:</span> {account.accountEmail || 'não informada'}</p>
          <p><span className="font-medium">Validade:</span> {account.expiresAt ? formatDateTime(account.expiresAt) : 'não informada'}</p>
        </div> : null}
        <div className="flex gap-3">
          <button type="button" onClick={handleConnect} disabled={actionLoading} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Conectar com ChatGPT</button>
          <button type="button" onClick={handleLogout} disabled={actionLoading || !account?.connected} className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium disabled:opacity-50">Desconectar</button>
        </div>
      </div>

      <form onSubmit={handleRun} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-lg font-semibold">Execução integrada (Fase 2)</h3>
        <p className="text-sm text-slate-500">Executa no pipeline padrão com profile <code>CHATGPT_CODEX</code>.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
            {environments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
            {models.map((item) => <option key={item.id} value={item.modelName}>{item.modelName}</option>)}
          </select>
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="Descreva a tarefa..." className="w-full rounded-md border px-3 py-2 text-sm" required />
        <button type="submit" disabled={actionLoading || !isConnected || !environment || !model} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Executar</button>
        {!isConnected ? <p className="text-sm text-amber-700 dark:text-amber-300">Bloqueado por autenticação ausente/expirada.</p> : null}
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-lg font-semibold">Últimas execuções ChatGPT</h3>
        {requestsLoading ? <p className="text-sm text-slate-500">Atualizando...</p> : null}
        <ul className="space-y-2">
          {requests.map((item) => (
            <li key={item.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">#{item.id} · {item.model}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${codexStatusStyles[item.status]}`}>{formatStatus(item.status)}</span>
              </div>
              <p className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>
              <Link to={`/codex/requests/${item.id}`} className="text-xs text-emerald-700 hover:underline">Abrir detalhes</Link>
            </li>
          ))}
        </ul>
        {!requestsLoading && requests.length === 0 ? <p className="text-sm text-slate-500">Nenhuma execução ainda.</p> : null}
      </div>
      {requests.some((item) => !isTerminalStatus(item.status)) ? <p className="text-xs text-slate-500">Monitoramento ativo a cada 5 segundos.</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}
