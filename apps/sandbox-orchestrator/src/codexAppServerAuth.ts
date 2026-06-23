import { CodexAppServerClient, CodexAppServerError } from './codexAppServerClient.js';

export interface CodexAccountState {
  requiresOpenaiAuth?: boolean;
  loginInProgress?: boolean;
  loginMode?: string | null;
  connected: boolean;
  status: 'connected' | 'disconnected' | 'unavailable';
  authMode?: string;
  planType?: string;
  executable: boolean;
  blockReason?: string | null;
}

export async function readCodexAccount(client: CodexAppServerClient): Promise<CodexAccountState> {
  if (!client.isReady()) {
    return {
      connected: false,
      status: 'unavailable',
      requiresOpenaiAuth: true,
      loginInProgress: false,
      loginMode: null,
      executable: false,
      blockReason: 'CODEX_APP_SERVER_UNAVAILABLE',
    };
  }

  try {
    const raw = await client.request<Record<string, unknown>>('account/read', { refreshToken: false });
    const authMode = asString(raw?.authMode ?? raw?.auth_mode);
    const planType = asString(raw?.planType ?? raw?.plan_type);
    const connected = Boolean(raw?.authMode ?? raw?.auth_mode ?? raw?.account ?? raw?.login);
    return {
      connected,
      status: connected ? 'connected' : 'disconnected',
      authMode,
      planType,
      requiresOpenaiAuth: true,
      loginInProgress: false,
      loginMode: null,
      executable: connected,
      blockReason: connected ? null : 'CODEX_NOT_AUTHENTICATED',
    };
  } catch (err) {
    const message = err instanceof CodexAppServerError ? err.message : String(err);
    return {
      connected: false,
      status: 'unavailable',
      requiresOpenaiAuth: true,
      loginInProgress: false,
      loginMode: null,
      executable: false,
      blockReason: message || 'CODEX_APP_SERVER_UNAVAILABLE',
    };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}


export interface CodexLoginStartState {
  status: 'authorization_pending';
  type: string;
  loginId: string;
  verificationUrl?: string;
  userCode?: string;
  authUrl?: string;
  interval?: number;
  expiresAt?: string;
}

export async function startCodexLogin(client: CodexAppServerClient, type = 'chatgptDeviceCode'): Promise<CodexLoginStartState> {
  if (!client.isReady()) {
    throw new CodexAppServerError('CODEX_APP_SERVER_UNAVAILABLE');
  }

  const raw = await client.request<Record<string, unknown>>('account/login/start', { type });
  const loginId = asString(raw?.loginId ?? raw?.login_id);
  if (!loginId) {
    throw new CodexAppServerError('CODEX_LOGIN_FAILED');
  }
  const responseType = asString(raw?.type) ?? type;
  const verificationUrl = asString(raw?.verificationUrl ?? raw?.verification_url);
  const userCode = asString(raw?.userCode ?? raw?.user_code);
  const authUrl = asString(raw?.authUrl ?? raw?.auth_url);
  const interval = typeof raw?.interval === 'number' ? raw.interval : undefined;
  const expiresAt = asString(raw?.expiresAt ?? raw?.expires_at);

  return {
    status: 'authorization_pending',
    type: responseType,
    loginId,
    ...(verificationUrl ? { verificationUrl } : {}),
    ...(userCode ? { userCode } : {}),
    ...(authUrl ? { authUrl } : {}),
    ...(interval ? { interval } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export async function cancelCodexLogin(client: CodexAppServerClient, loginId: string): Promise<Record<string, unknown>> {
  if (!client.isReady()) {
    throw new CodexAppServerError('CODEX_APP_SERVER_UNAVAILABLE');
  }
  return client.request<Record<string, unknown>>('account/login/cancel', { loginId });
}

export async function logoutCodexAccount(client: CodexAppServerClient): Promise<CodexAccountState> {
  if (!client.isReady()) {
    throw new CodexAppServerError('CODEX_APP_SERVER_UNAVAILABLE');
  }
  await client.request('account/logout');
  return readCodexAccount(client);
}
