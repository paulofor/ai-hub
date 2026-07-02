import { ChangeEvent, ClipboardEvent, FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { CodexProfile, CodexRequest, codexStatusStyles, formatDateTime, formatStatus, isTerminalStatus, parseCodexRequest, parseCodexRequests } from '../lib/codex';

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

const stripModelThinking = (content: string): string => {
  const trimmed = content.trim();
  if (!trimmed) return content;
  const validationIndex = trimmed.search(/(?:^|\n)Valida(?:ç|c)[aã]o executada com sucesso:/i);
  if (validationIndex > 0) {
    const beforeValidation = trimmed.slice(0, validationIndex).trimEnd();
    const paragraphStart = beforeValidation.lastIndexOf('\n\n');
    if (paragraphStart >= 0) {
      return `${beforeValidation.slice(paragraphStart + 2).trim()}\n\n${trimmed.slice(validationIndex).trimStart()}`;
    }
  }
  return trimmed;
};

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em] text-slate-900 dark:bg-slate-800 dark:text-slate-100">{match[2]}</code>);
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[3]}</strong>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

const MarkdownMessage = ({ content }: { content: string }) => {
  const normalized = stripModelThinking(content);
  const blocks = normalized.split(/(```[\s\S]*?```)/g).filter((block) => block.length > 0);
  return <div className="space-y-2 whitespace-normal break-words">
    {blocks.map((block, blockIndex) => {
      const codeMatch = block.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
      if (codeMatch) {
        return <pre key={`code-${blockIndex}`} className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs text-slate-50 dark:border-slate-700"><code>{codeMatch[2].trimEnd()}</code></pre>;
      }
      return block.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0).map((paragraph, paragraphIndex) => {
        const lines = paragraph.split('\n');
        const listItems = lines.filter((line) => /^\s*[-*]\s+/.test(line));
        if (listItems.length === lines.length && listItems.length > 0) {
          return <ul key={`list-${blockIndex}-${paragraphIndex}`} className="list-disc space-y-1 pl-5">
            {listItems.map((line, lineIndex) => <li key={lineIndex}>{renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, ''), `li-${blockIndex}-${paragraphIndex}-${lineIndex}`)}</li>)}
          </ul>;
        }
        return <p key={`p-${blockIndex}-${paragraphIndex}`} className="whitespace-pre-wrap">{renderInlineMarkdown(paragraph, `p-${blockIndex}-${paragraphIndex}`)}</p>;
      });
    })}
  </div>;
};

const CHATGPT_CODEX_MODELS: ModelOption[] = [
  { id: 55, modelName: 'gpt-5.5' },
  { id: 54, modelName: 'gpt-5.4' }
];

interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  requestId?: number;
  status?: CodexRequest['status'];
  createdAt: string;
}


const RESPONSE_READY_TITLE_PREFIX = '● ';
const RESPONSE_READY_MELODY_FREQUENCIES_HZ = [
  784,
  988,
  1175,
  988,
  1319,
  1175,
  988,
  880,
  1047,
  1319,
  1568,
  1319,
  1175,
  1568,
] as const;
const RESPONSE_READY_MELODY_REPETITIONS = 3;
const RESPONSE_READY_NOTE_DURATION_MS = 95;
const RESPONSE_READY_NOTE_GAP_MS = 18;
const RESPONSE_READY_MELODY_REPEAT_GAP_MS = 180;
const RESPONSE_READY_BEEP_VOLUME = 0.22;

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let responseReadyAudioContext: AudioContext | null = null;
let responseReadyAudioUnlocked = false;

const getResponseReadyAudioContext = (): AudioContext | null => {
  const AudioContextConstructor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  responseReadyAudioContext ??= new AudioContextConstructor();
  return responseReadyAudioContext;
};

const unlockResponseReadyAudio = () => {
  if (responseReadyAudioUnlocked) return;
  const audioContext = getResponseReadyAudioContext();
  if (!audioContext) return;
  void audioContext.resume().then(() => {
    responseReadyAudioUnlocked = true;
  }).catch(() => {
    responseReadyAudioUnlocked = false;
  });
};

const playResponseReadyBeep = () => {
  const audioContext = getResponseReadyAudioContext();
  if (!audioContext || !responseReadyAudioUnlocked) return;

  const now = audioContext.currentTime;
  const noteDurationSeconds = RESPONSE_READY_NOTE_DURATION_MS / 1000;
  const noteStepSeconds = (RESPONSE_READY_NOTE_DURATION_MS + RESPONSE_READY_NOTE_GAP_MS) / 1000;
  const repeatStepSeconds =
    RESPONSE_READY_MELODY_FREQUENCIES_HZ.length * noteStepSeconds + RESPONSE_READY_MELODY_REPEAT_GAP_MS / 1000;

  for (let repetition = 0; repetition < RESPONSE_READY_MELODY_REPETITIONS; repetition += 1) {
    RESPONSE_READY_MELODY_FREQUENCIES_HZ.forEach((frequency, noteIndex) => {
      const startTime = now + repetition * repeatStepSeconds + noteIndex * noteStepSeconds;
      const endTime = startTime + noteDurationSeconds;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(RESPONSE_READY_BEEP_VOLUME, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startTime);
      oscillator.stop(endTime);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }
};


const getFaviconLink = (): HTMLLinkElement | null => document.querySelector<HTMLLinkElement>("link[rel~='icon']");

const buildUnreadFaviconHref = (baseHref: string): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return baseHref;

  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = '#10b981';
  context.beginPath();
  context.arc(32, 32, 30, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = 'bold 42px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('!', 32, 35);

  return canvas.toDataURL('image/png');
};

const useModelResponseTabMarker = (conversation: ChatMessage[], title: string) => {
  const originalTitleRef = useRef<string | null>(null);
  const originalFaviconHrefRef = useRef<string | null>(null);
  const notifiedRequestIdsRef = useRef<Set<number>>(new Set());
  const previousStatusesRef = useRef<Map<number, CodexRequest['status']>>(new Map());

  const clearMarker = useCallback(() => {
    if (originalTitleRef.current) {
      document.title = originalTitleRef.current;
    }
    const favicon = getFaviconLink();
    if (favicon && originalFaviconHrefRef.current) {
      favicon.href = originalFaviconHrefRef.current;
    }
  }, []);

  const showMarker = useCallback(() => {
    originalTitleRef.current ??= document.title;
    const favicon = getFaviconLink();
    if (favicon) {
      originalFaviconHrefRef.current ??= favicon.href;
      favicon.href = buildUnreadFaviconHref(originalFaviconHrefRef.current);
    }
    document.title = `${RESPONSE_READY_TITLE_PREFIX}Resposta pronta — ${title}`;
  }, [title]);

  useEffect(() => {
    if (document.visibilityState === 'visible') {
      clearMarker();
    }
  }, [clearMarker]);

  useEffect(() => {
    window.addEventListener('pointerdown', unlockResponseReadyAudio);
    window.addEventListener('keydown', unlockResponseReadyAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockResponseReadyAudio);
      window.removeEventListener('keydown', unlockResponseReadyAudio);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        clearMarker();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      clearMarker();
    };
  }, [clearMarker]);

  useEffect(() => {
    const nextStatuses = new Map<number, CodexRequest['status']>();
    let shouldNotify = false;

    conversation.forEach((message) => {
      if (message.role !== 'assistant' || !message.requestId || !message.status) return;
      nextStatuses.set(message.requestId, message.status);
      const previousStatus = previousStatusesRef.current.get(message.requestId);
      const becameTerminal = previousStatus && !isTerminalStatus(previousStatus) && isTerminalStatus(message.status);
      if (becameTerminal && document.visibilityState === 'hidden' && !notifiedRequestIdsRef.current.has(message.requestId)) {
        notifiedRequestIdsRef.current.add(message.requestId);
        shouldNotify = true;
      }
    });

    previousStatusesRef.current = nextStatuses;
    if (shouldNotify) {
      showMarker();
      playResponseReadyBeep();
    }
  }, [conversation, showMarker]);
};

interface CodexChatgptPageProps {
  variant?: 'default' | 'marketing';
}

interface CodexChatgptVariantConfig {
  profile: CodexProfile;
  title: string;
  formTitle: string;
  description: string;
  historyTitle: string;
  placeholder: string;
  promptModeLine: string;
  promptExtraLines: string[];
}

const DEFAULT_VARIANT_CONFIG: CodexChatgptVariantConfig = {
  profile: 'CHATGPT_CODEX',
  title: 'Codex ChatGPT Managed',
  formTitle: 'Conversa interativa (Fase 2)',
  description: 'Envie uma solicitação, aguarde a resposta do modelo, continue conversando e peça o PR somente quando estiver satisfeito.',
  historyTitle: 'Últimas execuções ChatGPT',
  placeholder: 'Digite sua mensagem para o modelo... Cole prints com Ctrl+V. Quando estiver pronto, use Pedir PR.',
  promptModeLine: 'Você está em uma conversa interativa da Fase 2 do Codex ChatGPT Managed.',
  promptExtraLines: []
};

const MARKETING_VARIANT_CONFIG: CodexChatgptVariantConfig = {
  profile: 'CHATGPT_CODEX_MKT',
  title: 'Codex ChatGPT MKT',
  formTitle: 'Análise de relatórios de marketing',
  description: 'Envie uma solicitação, aguarde a análise dos relatórios Markdown do repositório, continue conversando e peça o PR somente quando estiver satisfeito.',
  historyTitle: 'Últimas execuções ChatGPT MKT',
  placeholder: 'Digite sua solicitação de análise de marketing... Ex.: avalie campanhas, estratégias, canais, resultados e gere orientações de melhoria.',
  promptModeLine: 'Você está em uma conversa interativa da Fase 2 do Codex ChatGPT Managed no modo MKT.',
  promptExtraLines: [
    'Use a sandbox para baixar e analisar o repositório como uma base de relatórios de marketing, principalmente arquivos Markdown.',
    'No lugar de atuar como programação, atue como analista de marketing digital: campanhas, estratégias, funis, canais, criativos, métricas, resultados, aprendizados e oportunidades.',
    'Gere relatórios de orientação com melhorias acionáveis para o usuário e preserve evidências dos arquivos analisados.',
    'Só crie ou prepare Pull Request quando o usuário pedir explicitamente o PR ou usar o botão Pedir PR.'
  ]
};

const resolveVariantConfig = (variant: CodexChatgptPageProps['variant']): CodexChatgptVariantConfig =>
  variant === 'marketing' ? MARKETING_VARIANT_CONFIG : DEFAULT_VARIANT_CONFIG;

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

export default function CodexChatgptPage({ variant = 'default' }: CodexChatgptPageProps) {
  const config = resolveVariantConfig(variant);
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
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<number | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prResult, setPrResult] = useState<{ url?: string; title?: string } | null>(null);
  const activeRequestPollInFlight = useRef(false);

  useModelResponseTabMarker(conversation, config.title);

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
      const parsed = parseCodexRequests(response.data).filter((item) => item.profile === config.profile);
      setRequests(parsed);
    } finally {
      setRequestsLoading(false);
    }
  }, [config.profile]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [accountResult, envResponse] = await Promise.all([
        client.get('/account/read').then((response) => ({ ok: true as const, data: response.data })).catch((err) => ({ ok: false as const, error: err as Error })),
        client.get<EnvironmentOption[]>('/environments')
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
      setModels(CHATGPT_CODEX_MODELS);
      setEnvironment((current) => current || envResponse.data[0]?.name || '');
      setModel((current) => CHATGPT_CODEX_MODELS.some((item) => item.modelName === current) ? current : CHATGPT_CODEX_MODELS[0].modelName);
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

  const buildConversationPrompt = useCallback((message: string) => {
    const history = conversation.map((item) => `${item.role === 'user' ? 'Usuário' : 'Modelo'}: ${item.content}`).join('\n\n');
    return [
      config.promptModeLine,
      'Responda à última mensagem do usuário e mantenha contexto das mensagens anteriores.',
      'Não crie Pull Request até o usuário pedir explicitamente o PR ou até o botão Pedir PR ser usado.',
      ...config.promptExtraLines,
      history ? `Histórico da conversa:\n${history}` : '',
      `Última mensagem do usuário:\n${message}`
    ].filter(Boolean).join('\n\n');
  }, [config.promptExtraLines, config.promptModeLine, conversation]);

  const extractAssistantContent = useCallback((request: CodexRequest) => request.responseText || request.executionLog || (request.status === 'FAILED' ? 'A execução falhou. Abra os detalhes para ver os logs.' : 'Resposta ainda não disponível.'), []);

  const updateAssistantFromRequest = useCallback((request: CodexRequest) => {
    setConversation((current) => current.map((message) => {
      if (message.role !== 'assistant' || message.requestId !== request.id) return message;
      return { ...message, status: request.status, content: isTerminalStatus(request.status) ? extractAssistantContent(request) : `Aguardando resposta do modelo... (${formatStatus(request.status)})` };
    }));
  }, [extractAssistantContent]);

  const handleRun = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isExecutable) {
      setError('Conta ChatGPT não executável pelo Codex App Server. Reconecte para executar.');
      return;
    }
    setActionLoading(true);
    try {
      const userMessage: ChatMessage = { id: `${Date.now()}-user`, role: 'user', content: prompt, createdAt: new Date().toISOString() };
      const requestPrompt = buildConversationPrompt(prompt);
      setConversation((current) => [...current, userMessage]);
      const response = await client.post('/codex/requests', {
        prompt: requestPrompt,
        environment,
        model,
        profile: config.profile,
        imageAttachments: imageAttachments.map(({ name, mimeType, size, dataUrl }) => ({ name, mimeType, size, dataUrl }))
      });
      const created = parseCodexRequest(response.data);
      if (created) {
        setActiveRequestId(created.id);
        setPrResult(null);
        setConversation((current) => [...current, { id: `${Date.now()}-assistant`, role: 'assistant', content: `Aguardando resposta do modelo... (${formatStatus(created.status)})`, requestId: created.id, status: created.status, createdAt: new Date().toISOString() }]);
      }
      setPrompt('');
      setImageAttachments([]);
      await loadRequests();
      registerTelemetry('execution_success', `Execução enviada com profile ${config.profile}.`);
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao executar requisição: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [buildConversationPrompt, config.profile, environment, imageAttachments, isExecutable, loadRequests, model, prompt, registerTelemetry]);


  useEffect(() => {
    if (!activeRequestId) return undefined;
    const refreshActiveRequest = () => {
      if (activeRequestPollInFlight.current) {
        return;
      }
      activeRequestPollInFlight.current = true;
      client.get(`/codex/requests/${activeRequestId}`)
        .then((response) => {
          const parsed = parseCodexRequest(response.data);
          if (!parsed) return;
          updateAssistantFromRequest(parsed);
          if (isTerminalStatus(parsed.status)) setActiveRequestId(null);
        })
        .catch((err: Error) => registerTelemetry('poll_error', `Falha ao atualizar conversa: ${err.message}`))
        .finally(() => {
          activeRequestPollInFlight.current = false;
        });
    };
    refreshActiveRequest();
    const intervalId = window.setInterval(refreshActiveRequest, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [activeRequestId, registerTelemetry, updateAssistantFromRequest]);

  const handleCreatePr = useCallback(async () => {
    const lastCompleted = [...conversation].reverse().find((message) => message.role === 'assistant' && message.requestId && message.status === 'COMPLETED');
    if (!lastCompleted?.requestId) {
      setError('Ainda não há resposta concluída para criar PR.');
      return;
    }
    setPrLoading(true);
    try {
      const response = await client.post(
        `/codex/requests/${lastCompleted.requestId}/create-pr`,
        {},
        {
          headers: {
            'X-Role': 'owner',
            'X-User': 'codex-ui'
          }
        }
      );
      setPrResult({ url: response.data?.url, title: response.data?.title });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPrLoading(false);
    }
  }, [conversation]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">{config.title}</h2>
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
        <h3 className="text-lg font-semibold">{config.formTitle}</h3>
        <p className="text-sm text-slate-500">{config.description}</p>
        {conversation.length > 0 ? <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          {conversation.map((message) => (
            <article key={message.id} className={`rounded-lg px-3 py-2 text-sm ${message.role === 'user' ? 'ml-auto max-w-3xl bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100' : 'mr-auto max-w-3xl bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100'}`}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{message.role === 'user' ? 'Usuário' : 'Modelo'}</span>
                {message.requestId ? <Link to={`/codex/requests/${message.requestId}`} className="normal-case text-emerald-700 hover:underline">Execução #{message.requestId}</Link> : null}
              </div>
              <MarkdownMessage content={message.content} />
            </article>
          ))}
        </div> : <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700">A conversa aparecerá aqui após a primeira mensagem.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
            {environments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
            {models.map((item) => <option key={item.id} value={item.modelName}>{item.modelName}</option>)}
          </select>
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onPaste={handlePromptPaste} rows={5} placeholder={config.placeholder} className="w-full rounded-md border px-3 py-2 text-sm" required />
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
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={actionLoading || !isExecutable || !environment || !model || Boolean(activeRequestId)} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Enviar mensagem</button>
          <button type="button" onClick={handleCreatePr} disabled={prLoading || Boolean(activeRequestId) || !conversation.some((message) => message.role === 'assistant' && message.status === 'COMPLETED')} className="rounded-md border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50">Pedir PR</button>
        </div>
        {prResult ? <p className="text-sm text-emerald-700">PR solicitado: {prResult.url ? <a href={prResult.url} target="_blank" rel="noreferrer" className="underline">{prResult.title || prResult.url}</a> : prResult.title || 'criado com sucesso'}</p> : null}
        {!isExecutable ? <p className="text-sm text-amber-700 dark:text-amber-300">Bloqueado: {account?.blockReason || 'Codex App Server sem conta executável.'}</p> : null}
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-lg font-semibold">{config.historyTitle}</h3>
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
