export type CodexProfile = 'STANDARD' | 'ECONOMY';

export type CodexStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface CodexRequest {
  id: number;
  environment: string;
  model: string;
  profile: CodexProfile;
  prompt: string;
  responseText?: string;
  externalId?: string;
  pullRequestUrl?: string;
  userComment?: string;
  problemDescription?: string;
  resolutionDifficulty?: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCost?: number;
  cachedPromptCost?: number;
  completionCost?: number;
  cost?: number;
  createdAt: string;
  status: CodexStatus;
  rating?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  timeoutCount?: number;
  httpGetCount?: number;
}

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseProfile = (value: unknown): CodexProfile => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'ECONOMY') {
      return 'ECONOMY';
    }
  }
  return 'STANDARD';
};

const parseStatus = (value: unknown): CodexStatus => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(normalized)) {
      return normalized as CodexStatus;
    }
  }
  return 'PENDING';
};

export const isTerminalStatus = (status: CodexStatus) =>
  status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';

export const formatStatus = (status: CodexStatus) => {
  switch (status) {
    case 'RUNNING':
      return 'Em execução';
    case 'COMPLETED':
      return 'Concluída';
    case 'FAILED':
      return 'Falhou';
    case 'CANCELLED':
      return 'Cancelada';
    case 'PENDING':
    default:
      return 'Pendente';
  }
};

export const formatDateTime = (value?: string) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('pt-BR');
};

export const formatDuration = (milliseconds?: number) => {
  if (milliseconds === undefined || milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return '—';
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}min`);
  }
  parts.push(`${seconds}s`);
  return parts.join(' ');
};

export const codexStatusStyles: Record<CodexStatus, string> = {
  PENDING: 'bg-slate-200 text-slate-700',
  RUNNING: 'bg-amber-200 text-amber-800 animate-pulse',
  COMPLETED: 'bg-emerald-200 text-emerald-800',
  FAILED: 'bg-red-200 text-red-800',
  CANCELLED: 'bg-slate-300 text-slate-700'
};

export const parseCodexRequest = (value: unknown): CodexRequest | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const id = parseNumber(item.id) ?? 0;
  const promptTokens = parseNumber(
    item.promptTokens ?? (item as Record<string, unknown>).prompt_tokens ?? (item as Record<string, unknown>).input_tokens
  );
  const cachedPromptTokens = parseNumber(
    item.cachedPromptTokens ??
      (item as Record<string, unknown>).cached_prompt_tokens ??
      (item as Record<string, unknown>).cachedInputTokens ??
      (item as Record<string, unknown>).cached_input_tokens
  );
  const completionTokens = parseNumber(
    item.completionTokens ??
      (item as Record<string, unknown>).completion_tokens ??
      (item as Record<string, unknown>).output_tokens
  );
  const totalTokens = parseNumber(item.totalTokens ?? (item as Record<string, unknown>).total_tokens);
  const promptCost = parseNumber(item.promptCost);
  const cachedPromptCost = parseNumber(item.cachedPromptCost);
  const completionCost = parseNumber(item.completionCost);
  const cost = parseNumber(item.cost);
  const profile = parseProfile(item.profile ?? item.integrationProfile);
  const status = parseStatus(item.status);
  const rating = parseNumber(item.rating);
  const startedAt = typeof item.startedAt === 'string' ? item.startedAt : undefined;
  const finishedAt = typeof item.finishedAt === 'string' ? item.finishedAt : undefined;
  const durationMs = parseNumber(item.durationMs);
  const timeoutCount = parseNumber(item.timeoutCount);
  const httpGetCount = parseNumber(item.httpGetCount);
  const pullRequestUrlRaw = typeof item.pullRequestUrl === 'string'
    ? item.pullRequestUrl
    : typeof (item as Record<string, unknown>).pull_request_url === 'string'
      ? ((item as Record<string, unknown>).pull_request_url as string)
      : undefined;
  const userCommentRaw = typeof item.userComment === 'string'
    ? item.userComment
    : typeof (item as Record<string, unknown>).user_comment === 'string'
      ? ((item as Record<string, unknown>).user_comment as string)
      : undefined;
  const problemDescriptionRaw = typeof item.problemDescription === 'string'
    ? item.problemDescription
    : typeof (item as Record<string, unknown>).problem_description === 'string'
      ? ((item as Record<string, unknown>).problem_description as string)
      : undefined;
  const resolutionDifficultyRaw = typeof item.resolutionDifficulty === 'string'
    ? item.resolutionDifficulty
    : typeof (item as Record<string, unknown>).resolution_difficulty === 'string'
      ? ((item as Record<string, unknown>).resolution_difficulty as string)
      : undefined;
  const pullRequestUrl = pullRequestUrlRaw && pullRequestUrlRaw.trim() ? pullRequestUrlRaw.trim() : undefined;
  const userComment = userCommentRaw && userCommentRaw.trim() ? userCommentRaw.trim() : undefined;
  const problemDescription = problemDescriptionRaw && problemDescriptionRaw.trim() ? problemDescriptionRaw.trim() : undefined;
  const resolutionDifficulty =
    resolutionDifficultyRaw && resolutionDifficultyRaw.trim() ? resolutionDifficultyRaw.trim() : undefined;

  return {
    id,
    environment: (item.environment as string) ?? '',
    model: (item.model as string) ?? '',
    profile,
    prompt: (item.prompt as string) ?? '',
    status,
    rating,
    responseText: (item.responseText as string) ?? undefined,
    externalId: (item.externalId as string) ?? undefined,
    pullRequestUrl: pullRequestUrl ?? undefined,
    userComment: userComment ?? undefined,
    problemDescription: problemDescription ?? undefined,
    resolutionDifficulty: resolutionDifficulty ?? undefined,
    promptTokens,
    cachedPromptTokens,
    completionTokens,
    totalTokens,
    promptCost,
    cachedPromptCost,
    completionCost,
    cost,
    createdAt: (item.createdAt as string) ?? '',
    startedAt,
    finishedAt,
    durationMs,
    timeoutCount,
    httpGetCount
  };
};

export const parseCodexRequests = (payload: unknown): CodexRequest[] => {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { content?: unknown })?.content)
      ? (payload as { content: unknown[] }).content
      : [];

  return items
    .map((item) => parseCodexRequest(item))
    .filter((item): item is CodexRequest => item !== null);
};

export const formatTokens = (value?: number) => {
  if (value === undefined || value === null) {
    return '—';
  }
  return value.toLocaleString('pt-BR');
};

export const formatCost = (value?: number, fractionDigits = 6) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
};

export const formatPricePerMillion = (value?: number) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(value);
};

export const formatProfile = (profile: CodexProfile) => {
  switch (profile) {
    case 'ECONOMY':
      return 'Econômico';
    case 'STANDARD':
    default:
      return 'Padrão';
  }
};
