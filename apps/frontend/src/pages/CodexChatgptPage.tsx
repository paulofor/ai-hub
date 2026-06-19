import { ChangeEvent, ClipboardEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { codexStatusStyles, formatDateTime, formatStatus, isTerminalStatus, parseCodexRequests } from '../lib/codex';

interface ChatgptAccountStatus {
  connected: boolean;
  status?: string;
  accountEmail?: string | null;
  expiresAt?: string | null;
  oauthConfigured?: boolean;
  oauthStatus?: string | null;
  oauthMessage?: string | null;
  deviceLoginAvailable?: boolean;
  deviceLoginClientId?: string | null;
}

interface DeviceLoginState {
  status: string;
  verificationUrl: string;
  userCode: string;
  interval: number;
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
const TELEMETRY_WINDOW_SIZE = 30;
const SESSION_WARNING_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_ACCOUNT_HINT = 'paulofore@gmail.com';
const MAX_IMAGE_ATTACHMENTS = 5;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

interface TelemetryEvent {
  id: string;
  type: 'poll_success' | 'poll_error' | 'login_started' | 'login_failed' | 'logout_success' | 'logout_failed' | 'execution_success' | 'execution_failed';
  message: string;
  createdAt: string;
}

const is404Error = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('404');
};

const is503Error = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('503');
};

const parseStatus = (payload: unknown): ChatgptAccountStatus => {
  if (!payload || typeof payload !== 'object') {
    return { connected: false, status: 'disconnected' };
  }

  const record = payload as Record<string, unknown>;
  const status = typeof record.status === 'string' ? record.status : undefined;
  const normalizedStatus = status?.toLowerCase();

  const accountEmail =
    typeof record.accountEmail === 'string'
      ? record.accountEmail
      : typeof record.account_email === 'string'
        ? record.account_email
        : null;

  const expiresAt =
    typeof record.expiresAt === 'string'
      ? record.expiresAt
      : typeof record.expires_at === 'string'
        ? record.expires_at
        : null;

  const connected =
    typeof record.connected === 'boolean'
      ? record.connected
      : normalizedStatus === 'connected' || normalizedStatus === 'ok' || normalizedStatus === 'active' || Boolean(accountEmail && expiresAt);

  const oauthConfigured =
    typeof record.oauthConfigured === 'boolean'
      ? record.oauthConfigured
      : true;

  const oauthStatus = typeof record.oauthStatus === 'string' ? record.oauthStatus : null;
  const oauthMessage = typeof record.oauthMessage === 'string' ? record.oauthMessage : null;
  const deviceLoginAvailable = typeof record.deviceLoginAvailable === 'boolean' ? record.deviceLoginAvailable : false;
  const deviceLoginClientId = typeof record.deviceLoginClientId === 'string' ? record.deviceLoginClientId : null;

  return {
    connected,
    status: status ?? (connected ? 'connected' : 'disconnected'),
    accountEmail,
    expiresAt,
    oauthConfigured,
    oauthStatus,
    oauthMessage,
    deviceLoginAvailable,
    deviceLoginClientId
  };
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
  const [knownAccounts, setKnownAccounts] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [accountHintInput, setAccountHintInput] = useState(DEFAULT_ACCOUNT_HINT);
  const [, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [accountApiAvailable, setAccountApiAvailable] = useState(true);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLoginState | null>(null);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);

  const registerTelemetry = useCallback((type: TelemetryEvent['type'], message: string) => {
    setTelemetry((current) => {
      const next: TelemetryEvent[] = [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          type,
          message,
          createdAt: new Date().toISOString()
        },
        ...current
      ];
      return next.slice(0, TELEMETRY_WINDOW_SIZE);
    });
  }, []);

  const includeKnownAccount = useCallback((email?: string | null) => {
    if (!email) {
      return;
    }
    setKnownAccounts((current) => (current.includes(email) ? current : [...current, email]));
    setSelectedAccount((current) => current || email);
    setAccountHintInput((current) => current || email);
  }, []);

  const loadAccount = useCallback(async () => {
    if (!accountApiAvailable) {
      setAccount({ connected: false, status: 'unsupported' });
      return;
    }
    try {
      const response = await client.get('/account/read');
      const parsed = parseStatus(response.data);
      setAccount(parsed);
      includeKnownAccount(parsed.accountEmail);
      setAccountApiAvailable(true);
    } catch (err) {
      if (is404Error(err)) {
        setAccountApiAvailable(false);
        setAccount({ connected: false, status: 'unsupported' });
        registerTelemetry('poll_error', 'API de conta indisponível neste ambiente (/account/* retornou 404).');
        return;
      }
      throw err;
    }
  }, [accountApiAvailable, includeKnownAccount, registerTelemetry]);

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
      const [accountResult, envResponse, modelResponse] = await Promise.all([
        client.get('/account/read').then((response) => ({ ok: true as const, data: response.data })).catch((err) => ({ ok: false as const, error: err as Error })),
        client.get<EnvironmentOption[]>('/environments'),
        client.get<ModelOption[]>('/codex/models')
      ]);
      if (accountResult.ok) {
        const parsedAccount = parseStatus(accountResult.data);
        setAccount(parsedAccount);
        includeKnownAccount(parsedAccount.accountEmail);
        setAccountApiAvailable(true);
      } else if (is404Error(accountResult.error)) {
        setAccountApiAvailable(false);
        setAccount({ connected: false, status: 'unsupported' });
        registerTelemetry('poll_error', 'API de conta indisponível neste ambiente (/account/* retornou 404).');
      } else {
        throw accountResult.error;
      }
      setEnvironments(envResponse.data);
      setModels(modelResponse.data);
      setEnvironment((current) => current || envResponse.data[0]?.name || '');
      setModel((current) => current || modelResponse.data[0]?.modelName || '');
      await loadRequests();
      registerTelemetry('poll_success', 'Leitura de conta e execuções atualizada com sucesso.');
      setError(null);
    } catch (err) {
      registerTelemetry('poll_error', `Falha no bootstrap/polling: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [includeKnownAccount, loadRequests, registerTelemetry]);

  useEffect(() => {
    loadBootstrap().catch(() => undefined);
  }, [loadBootstrap]);

  useEffect(() => {
    const interval = setInterval(() => {
      Promise.all([loadRequests(), loadAccount()])
        .then(() => registerTelemetry('poll_success', 'Polling periódico concluído.'))
        .catch((err: Error) => registerTelemetry('poll_error', `Falha no polling periódico: ${err.message}`));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAccount, loadRequests, registerTelemetry]);

  const accountExpired = useMemo(() => {
    if (!account?.expiresAt) {
      return false;
    }
    const expiresAt = new Date(account.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  }, [account]);

  const deviceLoginReady = accountApiAvailable && (account?.deviceLoginAvailable ?? true);
  const oauthReady = accountApiAvailable && ((account?.oauthConfigured ?? false) || deviceLoginReady);
  const isConnected = Boolean(account?.connected) && !accountExpired && account?.status !== 'expired';
  const expiresSoon = useMemo(() => {
    if (!account?.expiresAt) {
      return false;
    }
    const delta = new Date(account.expiresAt).getTime() - Date.now();
    return Number.isFinite(delta) && delta > 0 && delta <= SESSION_WARNING_WINDOW_MS;
  }, [account]);

  const handleConnect = useCallback(async () => {
    setActionLoading(true);
    try {
      if (!accountApiAvailable) {
        setError('Este ambiente não expõe a API de conta (/account/*). Contate o administrador para habilitar a integração.');
        return;
      }
      if (!deviceLoginReady) {
        const reason = account?.oauthMessage || 'Login por código indisponível no servidor.';
        setError(`${reason} Peça ao administrador para revisar a integração ChatGPT/Codex no backend.`);
        registerTelemetry('login_failed', `Login por código bloqueado: ${reason}`);
        return;
      }
      const sanitizedHint = accountHintInput.trim();
      const accountHint = sanitizedHint || selectedAccount;
      const response = await client.post('/account/device/start', accountHint ? { accountHint } : {});
      const verificationUrl = response.data?.verificationUrl;
      const userCode = response.data?.userCode;
      const interval = Number(response.data?.interval || 5);
      if (typeof verificationUrl !== 'string' || verificationUrl.length === 0 || typeof userCode !== 'string' || userCode.length === 0) {
        throw new Error('Servidor não retornou verificationUrl/userCode para login por código.');
      }
      setDeviceLogin({
        status: response.data?.status || 'authorization_pending',
        verificationUrl,
        userCode,
        interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
        expiresAt: typeof response.data?.expiresAt === 'string' ? response.data.expiresAt : null
      });
      const opened = window.open(verificationUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        registerTelemetry('login_started', 'Login por código iniciado; abertura automática bloqueada pelo navegador.');
      } else {
        registerTelemetry('login_started', 'Login por código iniciado e página da OpenAI aberta.');
      }
      setError(null);
    } catch (err) {
      if (is404Error(err)) {
        setAccountApiAvailable(false);
        setAccount({ connected: false, status: 'unsupported' });
        registerTelemetry('login_failed', 'Endpoint de login por código indisponível: /account/device/start retornou 404.');
        setError('Este ambiente não expõe login por código (/account/device/start). Contate o administrador para habilitar a integração.');
        return;
      }
      if (is503Error(err)) {
        registerTelemetry('login_failed', 'Serviço de login por código indisponível: /account/device/start retornou 503.');
        setError('Serviço de login temporariamente indisponível (503). Peça ao administrador para revisar a integração ChatGPT/Codex no backend.');
        return;
      }
      registerTelemetry('login_failed', `Falha ao iniciar login por código: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [account, accountApiAvailable, accountHintInput, deviceLoginReady, registerTelemetry, selectedAccount]);

  useEffect(() => {
    if (!deviceLogin || isConnected) {
      return undefined;
    }
    const delay = Math.max(2, deviceLogin.interval || 5) * 1000;
    const intervalId = window.setInterval(() => {
      client.post('/account/device/poll')
        .then(async (response) => {
          const status = response.data?.status || 'authorization_pending';
          if (status === 'connected') {
            setDeviceLogin(null);
            await loadAccount();
            registerTelemetry('login_started', 'Login por código concluído; sessão ChatGPT conectada.');
            setError(null);
            return;
          }
          if (status === 'expired') {
            setDeviceLogin(null);
            registerTelemetry('login_failed', 'Código de login expirou antes da autorização.');
            setError('Código de login expirou. Clique em Conectar com ChatGPT para gerar um novo código.');
            return;
          }
          setDeviceLogin((current) => current ? { ...current, status } : current);
        })
        .catch((err: Error) => {
          registerTelemetry('login_failed', `Falha no polling do login por código: ${err.message}`);
        });
    }, delay);
    return () => window.clearInterval(intervalId);
  }, [deviceLogin, isConnected, loadAccount, registerTelemetry]);

  const handleLogout = useCallback(async () => {
    setActionLoading(true);
    try {
      await client.post('/account/logout');
      await loadAccount();
      registerTelemetry('logout_success', 'Sessão ChatGPT desconectada com sucesso.');
    } catch (err) {
      registerTelemetry('logout_failed', `Falha ao desconectar: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [loadAccount, registerTelemetry]);


  const readImageFile = useCallback((file: File): Promise<ImageAttachment> => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`O arquivo ${file.name || 'sem nome'} não é uma imagem.`));
      return;
    }
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      reject(new Error(`A imagem ${file.name || 'sem nome'} excede o limite de 5 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Não foi possível ler a imagem ${file.name || 'sem nome'}.`));
        return;
      }
      resolve({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || `imagem-${Date.now()}.png`,
        mimeType: file.type || 'image/png',
        size: file.size,
        dataUrl: reader.result
      });
    };
    reader.onerror = () => reject(new Error(`Falha ao ler a imagem ${file.name || 'sem nome'}.`));
    reader.readAsDataURL(file);
  }), []);

  const appendImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const slotsAvailable = MAX_IMAGE_ATTACHMENTS - imageAttachments.length;
    if (slotsAvailable <= 0) {
      setError(`Limite de ${MAX_IMAGE_ATTACHMENTS} imagens por solicitação atingido.`);
      return;
    }
    try {
      const nextAttachments = await Promise.all(files.slice(0, slotsAvailable).map(readImageFile));
      setImageAttachments((current) => [...current, ...nextAttachments]);
      setError(files.length > slotsAvailable ? `Foram anexadas ${slotsAvailable} imagens; o limite é ${MAX_IMAGE_ATTACHMENTS}.` : null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [imageAttachments.length, readImageFile]);

  const handlePromptPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void appendImageFiles(files);
  }, [appendImageFiles]);

  const handleImageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void appendImageFiles(files);
  }, [appendImageFiles]);

  const removeImageAttachment = useCallback((id: string) => {
    setImageAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

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
        profile: 'CHATGPT_CODEX',
        imageAttachments: imageAttachments.map(({ name, mimeType, size, dataUrl }) => ({ name, mimeType, size, dataUrl }))
      });
      setPrompt('');
      setImageAttachments([]);
      await loadRequests();
      registerTelemetry('execution_success', 'Execução enviada com profile CHATGPT_CODEX.');
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao executar requisição: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [environment, imageAttachments, isConnected, loadRequests, model, prompt, registerTelemetry]);

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
          <button type="button" onClick={handleConnect} disabled={actionLoading || !accountApiAvailable || !oauthReady} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Conectar com ChatGPT</button>
          <button type="button" onClick={handleLogout} disabled={actionLoading || !account?.connected} className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium disabled:opacity-50">Desconectar</button>
        </div>
        {deviceLogin ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100 space-y-2">
          <p className="font-semibold">Login OpenAI/ChatGPT por código em andamento</p>
          <p>Abra a página da OpenAI e informe o código abaixo. O AI Hub confirmará automaticamente quando a autorização terminar.</p>
          <p><span className="font-medium">URL:</span> <a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer" className="underline">{deviceLogin.verificationUrl}</a></p>
          <p><span className="font-medium">Código:</span> <code className="rounded bg-white/80 px-2 py-1 text-base font-bold tracking-widest dark:bg-slate-900">{deviceLogin.userCode}</code></p>
          <p className="text-xs">Status: {deviceLogin.status}. {deviceLogin.expiresAt ? `Expira em ${formatDateTime(deviceLogin.expiresAt)}.` : ''}</p>
        </div> : null}
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Informe o e-mail da conta OpenAI para associar a sessão às execuções após o login por código.</p>
          <input
            type="email"
            value={accountHintInput}
            onChange={(e) => setAccountHintInput(e.target.value)}
            placeholder="voce@empresa.com"
            className="w-full rounded-md border px-3 py-2 text-sm md:max-w-md"
          />
        </div>
        {knownAccounts.length > 0 ? <div className="space-y-2">
          <p className="text-xs text-slate-500">Multi-conta (opcional): selecione um e-mail salvo para preencher automaticamente.</p>
          <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
            {knownAccounts.map((email) => <option key={email} value={email}>{email}</option>)}
          </select>
        </div> : null}
        {expiresSoon ? <p className="text-xs text-amber-700 dark:text-amber-300">Sessão próxima da expiração (menos de 5 minutos). Recomendado reconectar para evitar falhas.</p> : null}
        {!accountApiAvailable ? <p className="text-sm text-amber-700 dark:text-amber-300">Integração de autenticação indisponível: backend não possui rotas <code>/account/*</code> (retorno 404).</p> : null}
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
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onPaste={handlePromptPaste} rows={5} placeholder="Descreva a tarefa... Cole prints da área de transferência aqui (Ctrl+V)." className="w-full rounded-md border px-3 py-2 text-sm" required />
        <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Anexar imagens
            <input type="file" accept="image/*" multiple onChange={handleImageInputChange} className="sr-only" />
          </label>
          <p className="mt-2 text-xs text-slate-500">Cole prints com Ctrl+V no campo da tarefa ou selecione arquivos. Até {MAX_IMAGE_ATTACHMENTS} imagens de 5 MB.</p>
          {imageAttachments.length > 0 ? <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {imageAttachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800">
                <img src={attachment.dataUrl} alt={attachment.name} className="h-14 w-20 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{attachment.name}</p>
                  <p className="text-[11px] text-slate-500">{Math.ceil(attachment.size / 1024)} KB</p>
                </div>
                <button type="button" onClick={() => removeImageAttachment(attachment.id)} className="text-xs text-rose-600 hover:underline">Remover</button>
              </li>
            ))}
          </ul> : null}
        </div>
        <button type="submit" disabled={actionLoading || !isConnected || !environment || !model} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Executar</button>
        {!isConnected ? <p className="text-sm text-amber-700 dark:text-amber-300">Bloqueado por autenticação ausente/expirada.</p> : null}
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-lg font-semibold">Últimas execuções ChatGPT</h3>
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
