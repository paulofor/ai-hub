import { ChangeEvent, ClipboardEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { codexStatusStyles, formatDateTime, formatStatus, isTerminalStatus, parseCodexRequests } from '../lib/codex';

interface ChatgptAccountStatus {
  connected: boolean;
  status?: string;
  authMode?: string | null;
  planType?: string | null;
  executable?: boolean;
  blockReason?: string | null;
  requiresOpenaiAuth?: boolean;
  loginInProgress?: boolean;
  loginMode?: string | null;
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

  const connected = typeof record.connected === 'boolean' ? record.connected : normalizedStatus === 'connected';
  const executable = typeof record.executable === 'boolean' ? record.executable : connected;
  const authMode = typeof record.authMode === 'string' ? record.authMode : typeof record.auth_mode === 'string' ? record.auth_mode : null;
  const planType = typeof record.planType === 'string' ? record.planType : typeof record.plan_type === 'string' ? record.plan_type : null;
  const blockReason = typeof record.blockReason === 'string' ? record.blockReason : typeof record.block_reason === 'string' ? record.block_reason : null;
  const requiresOpenaiAuth = typeof record.requiresOpenaiAuth === 'boolean' ? record.requiresOpenaiAuth : true;
  const loginInProgress = typeof record.loginInProgress === 'boolean' ? record.loginInProgress : false;
  const loginMode = typeof record.loginMode === 'string' ? record.loginMode : null;

  return {
    connected,
    status: status ?? (connected ? 'connected' : 'disconnected'),
    authMode,
    planType,
    executable,
    blockReason,
    requiresOpenaiAuth,
    loginInProgress,
    loginMode
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

  const loadAccount = useCallback(async () => {
    if (!accountApiAvailable) {
      setAccount({ connected: false, status: 'unsupported' });
      return;
    }
    try {
      const response = await client.get('/account/read');
      const parsed = parseStatus(response.data);
      setAccount(parsed);
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
  }, [accountApiAvailable, registerTelemetry]);

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
  }, [loadRequests, registerTelemetry]);

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

  const isConnected = Boolean(account?.connected) && account?.status === 'connected';
  const isExecutable = Boolean(account?.executable) && isConnected;

  const handleConnect = useCallback(async () => {
    setActionLoading(true);
    try {
      if (!accountApiAvailable) {
        setError('Este ambiente não expõe a API de conta (/account/*). Contate o administrador para habilitar a integração.');
        return;
      }
      const response = await client.post('/account/login/start', { type: 'chatgptDeviceCode' });
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
      window.open(verificationUrl, '_blank', 'noopener,noreferrer');
      registerTelemetry('login_started', 'Login por código iniciado via Codex App Server.');
      setError(null);
    } catch (err) {
      if (is404Error(err)) {
        setAccountApiAvailable(false);
        setAccount({ connected: false, status: 'unsupported', executable: false });
        registerTelemetry('login_failed', 'Endpoint de login indisponível: /account/login/start retornou 404.');
        setError('Este ambiente não expõe login Codex (/account/login/start). Contate o administrador para habilitar a integração.');
        return;
      }
      if (is503Error(err)) {
        registerTelemetry('login_failed', 'Serviço de login indisponível: backend retornou 503.');
        setError('Serviço de login temporariamente indisponível (503). O Codex App Server pode não estar pronto.');
        return;
      }
      registerTelemetry('login_failed', `Falha ao iniciar login por código: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [accountApiAvailable, registerTelemetry]);

  useEffect(() => {
    if (!deviceLogin || isConnected) {
      return undefined;
    }
    const delay = Math.max(2, deviceLogin.interval || 5) * 1000;
    const intervalId = window.setInterval(() => {
      client.post('/account/device/poll')
        .then(async (response) => {
          const status = response.data?.status || 'authorization_pending';
          if (status === 'connected' || response.data?.executable === true) {
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
    if (!isExecutable) {
      setError('Conta ChatGPT não executável pelo Codex App Server. Reconecte para executar.');
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
  }, [environment, imageAttachments, isExecutable, loadRequests, model, prompt, registerTelemetry]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Codex ChatGPT Managed</h2>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-4">
        <h3 className="text-lg font-semibold">Estado da conta (tempo real)</h3>
        {loading ? <p className="text-sm text-slate-500">Carregando status...</p> : null}
        {account ? <div className="space-y-1 text-sm">
          <p><span className="font-medium">Status:</span> {account.status ?? 'disconnected'}</p>
          <p><span className="font-medium">Conectado:</span> {isConnected ? 'Sim' : 'Não'}</p>
          <p><span className="font-medium">Auth mode:</span> {account.authMode || 'não informado'}</p>
          <p><span className="font-medium">Plano:</span> {account.planType || 'não informado'}</p>
          <p><span className="font-medium">Executável:</span> {account.executable ? 'Sim' : 'Não'}</p>
          {account.blockReason ? <p><span className="font-medium">Bloqueio:</span> {account.blockReason}</p> : null}
        </div> : null}
        <div className="flex gap-3">
          <button type="button" onClick={handleConnect} disabled={actionLoading || !accountApiAvailable} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Conectar com ChatGPT</button>
          <button type="button" onClick={handleLogout} disabled={actionLoading || !account?.connected} className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium disabled:opacity-50">Desconectar</button>
        </div>
        {deviceLogin ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100 space-y-2">
          <p className="font-semibold">Login OpenAI/ChatGPT por código em andamento</p>
          <p>Abra a página da OpenAI e informe o código abaixo. O AI Hub confirmará automaticamente quando a autorização terminar.</p>
          <p><span className="font-medium">URL:</span> <a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer" className="underline">{deviceLogin.verificationUrl}</a></p>
          <p><span className="font-medium">Código:</span> <code className="rounded bg-white/80 px-2 py-1 text-base font-bold tracking-widest dark:bg-slate-900">{deviceLogin.userCode}</code></p>
          <p className="text-xs">Status: {deviceLogin.status}. {deviceLogin.expiresAt ? `Expira em ${formatDateTime(deviceLogin.expiresAt)}.` : ''}</p>
        </div> : null}
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
        <button type="submit" disabled={actionLoading || !isExecutable || !environment || !model} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Executar</button>
        {!isExecutable ? <p className="text-sm text-amber-700 dark:text-amber-300">Bloqueado: {account?.blockReason || 'Codex App Server sem conta executável.'}</p> : null}
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
