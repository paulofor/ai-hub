import { ChangeEvent, ClipboardEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import MarkdownFileReference, { isFileReferenceHref } from '../components/MarkdownFileReference';
import { CodexProfile, CodexRequest, codexStatusStyles, formatCost, formatDateTime, formatDuration, formatProfile, formatStatus, formatTokens, isTerminalStatus, parseCodexRequest, parseCodexRequests } from '../lib/codex';

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

interface DiscardBatchResult {
  deleted?: number;
  cancelled?: number;
  detached?: number;
  branchDeleted?: boolean;
  branchDeletionWarning?: string;
  total?: number;
}

interface CodexDashboardMetricWindow {
  startsAt: string;
  requestCount: number;
  interactionCount: number;
  durationMs: number;
}

interface CodexSalesImpactScore {
  muitoBaixo: number;
  baixo: number;
  medio: number;
  alto: number;
  muitoAlto: number;
  total: number;
}

interface CodexDashboardMetrics {
  day: CodexDashboardMetricWindow;
  salesImpactDay?: CodexSalesImpactScore;
}

interface EnvironmentOption {
  id: number;
  name: string;
}

interface ModelOption {
  id: string;
  modelName: string;
  displayName?: string;
}

interface ProductOption {
  id: number;
  name: string;
  slug: string;
}

interface PromptHintOption {
  id: number;
  label: string;
  phrase: string;
  type?: 'prompt' | 'text' | string | null;
  environmentId?: number | null;
  environmentName?: string | null;
}

interface SavedConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

interface SavedConversation {
  id: number;
  title: string;
  environment?: string;
  model?: string;
  profile: CodexProfile;
  messageCount: number;
  messages: SavedConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 5000;
const INTERACTION_STALE_ALERT_MS = 5 * 60 * 1000;
const TELEMETRY_WINDOW_SIZE = 30;
const MAX_FILE_ATTACHMENTS = 5;
const MAX_FILE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_VISIBLE_CONVERSATION_MESSAGES = 20;
const MAX_ACTIVE_CONVERSATION_REQUESTS = 20;
const CHAT_CONVERSATION_STORAGE_PREFIX = 'ai-hub:codex-chat-conversation:';
const READ_COMMENTS_STORAGE_PREFIX = 'ai-hub:codex-chat-read-comments:';
const HIDDEN_REQUESTS_STORAGE_PREFIX = 'ai-hub:codex-chat-hidden-requests:';
const SANDBOX_ONLY_ENVIRONMENT = 'sandbox';

const normalizePromptHintType = (type?: string | null): 'prompt' | 'text' =>
  type?.toLowerCase() === 'text' ? 'text' : 'prompt';

const promptHintTypeLabel = (type?: string | null) =>
  normalizePromptHintType(type) === 'text' ? 'Tela' : 'Prompt';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const appendPromptText = (current: string, phrase: string) => {
  const trimmedPhrase = phrase.trim();
  if (!trimmedPhrase) {
    return current;
  }
  const trimmedCurrent = current.trimEnd();
  return trimmedCurrent ? `${trimmedCurrent}\n\n${trimmedPhrase}` : trimmedPhrase;
};

const removePromptText = (current: string, phrase: string) => {
  const trimmedPhrase = phrase.trim();
  if (!trimmedPhrase) {
    return current;
  }
  return current
    .replace(new RegExp(`\\n{0,2}${escapeRegExp(trimmedPhrase)}\\s*$`), '')
    .trimEnd();
};

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Navegadores podem expor a API e ainda negar a permissao; use o fallback abaixo.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('document.execCommand(copy) retornou falso');
  }
};

const readCommentsStorageKey = (profile: CodexProfile) => `${READ_COMMENTS_STORAGE_PREFIX}${profile}`;
const hiddenRequestsStorageKey = (profile: CodexProfile) => `${HIDDEN_REQUESTS_STORAGE_PREFIX}${profile}`;

const loadReadCommentIds = (profile: CodexProfile): Set<string> => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(readCommentsStorageKey(profile)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
};

const loadHiddenRequestIds = (profile: CodexProfile): Set<number> => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(hiddenRequestsStorageKey(profile)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : []);
  } catch {
    return new Set();
  }
};

const isClosedBatchRequest = (request: CodexRequest): boolean =>
  request.status === 'COMPLETED' && Boolean(request.pullRequestUrl);

const isOpenBatchRequest = (request: CodexRequest): boolean =>
  Boolean(request.workBatchKey || request.workBranch) && !isClosedBatchRequest(request);

const getBatchKey = (request?: CodexRequest): string | undefined =>
  request?.workBatchKey || request?.workBranch;

const findOpenBatchKey = (
  requests: CodexRequest[],
  environment: string,
  profile: CodexProfile
): string | undefined =>
  getBatchKey(requests
    .filter((item) => item.environment === environment && item.profile === profile)
    .find((item) => isOpenBatchRequest(item)));

const getOpenBatchRequests = (
  requests: CodexRequest[],
  environment: string,
  profile: CodexProfile,
  batchKey?: string
): CodexRequest[] => {
  const resolvedBatchKey = batchKey ?? findOpenBatchKey(requests, environment, profile);
  if (!resolvedBatchKey) {
    return [];
  }
  return requests.filter((item) => {
    if (item.profile !== profile || isClosedBatchRequest(item)) {
      return false;
    }
    return item.workBatchKey === resolvedBatchKey || item.workBranch === resolvedBatchKey;
  });
};

const isCancellableRequestStatus = (status?: CodexRequest['status']): boolean =>
  status === 'RUNNING';

const formatInteractionCount = (count?: number) => {
  if (count === undefined || count === null || !Number.isFinite(count)) {
    return '—';
  }
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? 'interação' : 'interações'}`;
};

const formatDocumentAccessCount = (count?: number) => {
  if (count === undefined || count === null || !Number.isFinite(count)) {
    return '—';
  }
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? 'documento' : 'documentos'}`;
};

const formatMetricNumber = (value?: number) => {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
};

const formatOperationalDayDate = (value?: string) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo'
  });
};

const formatRequestEnvironment = (environment?: string) => {
  const value = environment?.trim();
  return value ? value : 'Ambiente não informado';
};

const maxDefinedNumber = (...values: Array<number | undefined>) => {
  const definedValues = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return definedValues.length > 0 ? Math.max(...definedValues) : undefined;
};

const mergeCodexRequestItem = (current: CodexRequest | undefined, updated: CodexRequest): CodexRequest => {
  if (!current) return updated;

  const merged: CodexRequest = { ...current, ...updated };
  if (!isTerminalStatus(updated.status)) {
    merged.interactionCount = maxDefinedNumber(current.interactionCount, updated.interactionCount);
    merged.documentAccessCount = maxDefinedNumber(current.documentAccessCount, updated.documentAccessCount);
    merged.documentAccesses = updated.documentAccesses.length >= current.documentAccesses.length
      ? updated.documentAccesses
      : current.documentAccesses;
  }
  return merged;
};

const mergeCodexRequestList = (current: CodexRequest[], updated: CodexRequest[]) => {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return updated.map((item) => mergeCodexRequestItem(currentById.get(item.id), item));
};

const mergeCodexRequest = (current: CodexRequest[], updated: CodexRequest) =>
  current.map((item) => item.id === updated.id ? mergeCodexRequestItem(item, updated) : item);

const parseSavedConversationMessage = (value: unknown): SavedConversationMessage | null => {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  const content = typeof item.content === 'string' ? item.content : '';
  if (!content.trim()) return null;
  const rawRole = typeof item.role === 'string' ? item.role.trim().toLowerCase() : 'user';
  return {
    role: rawRole === 'assistant' || rawRole === 'model' || rawRole === 'modelo' ? 'assistant' : 'user',
    content,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined
  };
};

const parseSavedConversation = (value: unknown): SavedConversation | null => {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'number' ? item.id : Number(item.id);
  if (!Number.isFinite(id)) return null;
  const profileRaw = typeof item.profile === 'string' ? item.profile.trim().toUpperCase().replace('-', '_') : 'CHATGPT_CODEX';
  const profile: CodexProfile = profileRaw === 'CHATGPT_CODEX_MKT'
    ? 'CHATGPT_CODEX_MKT'
    : profileRaw === 'CHATGPT_CODEX_SANDBOX'
      ? 'CHATGPT_CODEX_SANDBOX'
      : 'CHATGPT_CODEX';
  const messages = Array.isArray(item.messages)
    ? item.messages.map(parseSavedConversationMessage).filter((message): message is SavedConversationMessage => message !== null)
    : [];
  const messageCount = typeof item.messageCount === 'number' ? item.messageCount : Number(item.messageCount ?? messages.length);
  return {
    id,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Conversa #${id}`,
    environment: typeof item.environment === 'string' && item.environment.trim() ? item.environment.trim() : undefined,
    model: typeof item.model === 'string' && item.model.trim() ? item.model.trim() : undefined,
    profile,
    messageCount: Number.isFinite(messageCount) ? messageCount : messages.length,
    messages,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
  };
};

const parseSavedConversations = (payload: unknown): SavedConversation[] => {
  const items = Array.isArray(payload) ? payload : [];
  return items.map(parseSavedConversation).filter((item): item is SavedConversation => item !== null);
};

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

const renderFileReference = (label: string, href: string, key: string) => {
  return <MarkdownFileReference key={key} label={label} href={href} />;
};

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined && match[3] !== undefined) {
      if (isFileReferenceHref(match[3])) {
        nodes.push(renderFileReference(match[2], match[3], `${keyPrefix}-file-${match.index}`));
      } else {
        nodes.push(<a key={`${keyPrefix}-link-${match.index}`} href={match[3]} className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-100" target="_blank" rel="noreferrer">{match[2]}</a>);
      }
    } else if (match[4] !== undefined) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em] text-slate-900 dark:bg-slate-800 dark:text-slate-100">{match[4]}</code>);
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[5]}</strong>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

const renderMarkdownListItem = (item: string, keyPrefix: string) => {
  const filePrefixMatch = item.match(/^\[([^\]]+)\]\(([^)\s]+)\):\s*(.*)$/);
  if (filePrefixMatch && isFileReferenceHref(filePrefixMatch[2])) {
    return (
      <div className="space-y-1">
        <div>{renderFileReference(filePrefixMatch[1], filePrefixMatch[2], `${keyPrefix}-file-reference`)}</div>
        {filePrefixMatch[3] ? <div>{renderInlineMarkdown(filePrefixMatch[3], `${keyPrefix}-description`)}</div> : null}
      </div>
    );
  }

  return renderInlineMarkdown(item, keyPrefix);
};

const splitMarkdownTableRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const isMarkdownTableDivider = (line: string) => {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const parseMarkdownTable = (paragraph: string) => {
  const lines = paragraph.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2 || !lines.every((line) => line.includes('|')) || !isMarkdownTableDivider(lines[1])) {
    return null;
  }

  const headers = splitMarkdownTableRow(lines[0]);
  const rows = lines.slice(2).map(splitMarkdownTableRow);
  if (headers.length < 2 || rows.some((row) => row.length !== headers.length)) {
    return null;
  }

  return { headers, rows };
};

const headingClasses: Record<number, string> = {
  1: 'text-xl font-semibold',
  2: 'text-lg font-semibold',
  3: 'text-base font-semibold',
  4: 'text-sm font-semibold',
  5: 'text-sm font-semibold',
  6: 'text-sm font-semibold'
};

const renderMarkdownTable = (table: NonNullable<ReturnType<typeof parseMarkdownTable>>, key: string) => (
  <div key={key} className="overflow-x-auto">
    <table className="min-w-full border-collapse text-left text-sm">
      <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        <tr>{table.headers.map((header, cellIndex) => <th key={cellIndex} className="border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">{renderInlineMarkdown(header, `${key}-th-${cellIndex}`)}</th>)}</tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => <tr key={rowIndex} className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-950/40">
          {row.map((cell, cellIndex) => <td key={cellIndex} className="border border-slate-200 px-3 py-2 align-top dark:border-slate-700">{renderInlineMarkdown(cell, `${key}-td-${rowIndex}-${cellIndex}`)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
);

const renderMarkdownTextBlock = (block: string, blockIndex: number): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const paragraphLines: string[] = [];
  const lines = block.split('\n');

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const paragraph = paragraphLines.join('\n').trim();
    if (paragraph) {
      const key = `p-${blockIndex}-${nodes.length}`;
      nodes.push(<p key={key} className="whitespace-pre-wrap">{renderInlineMarkdown(paragraph, key)}</p>);
    }
    paragraphLines.length = 0;
  };

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const line = lines[lineIndex];
    if (!line.trim()) {
      flushParagraph();
      lineIndex += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const key = `heading-${blockIndex}-${lineIndex}`;
      const content = renderInlineMarkdown(headingMatch[2], key);
      if (level === 1) nodes.push(<h1 key={key} className={headingClasses[level]}>{content}</h1>);
      else if (level === 2) nodes.push(<h2 key={key} className={headingClasses[level]}>{content}</h2>);
      else if (level === 3) nodes.push(<h3 key={key} className={headingClasses[level]}>{content}</h3>);
      else if (level === 4) nodes.push(<h4 key={key} className={headingClasses[level]}>{content}</h4>);
      else if (level === 5) nodes.push(<h5 key={key} className={headingClasses[level]}>{content}</h5>);
      else nodes.push(<h6 key={key} className={headingClasses[level]}>{content}</h6>);
      lineIndex += 1;
      continue;
    }

    if (line.includes('|') && lineIndex + 1 < lines.length && isMarkdownTableDivider(lines[lineIndex + 1])) {
      flushParagraph();
      const tableLines = [line, lines[lineIndex + 1]];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].includes('|') && lines[lineIndex].trim()) {
        tableLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      const table = parseMarkdownTable(tableLines.join('\n'));
      if (table) {
        nodes.push(renderMarkdownTable(table, `table-${blockIndex}-${nodes.length}`));
      } else {
        paragraphLines.push(...tableLines);
      }
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      const items: string[] = [];
      while (lineIndex < lines.length) {
        const itemMatch = lines[lineIndex].match(/^\s*[-*]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        lineIndex += 1;
      }
      nodes.push(<ul key={`ul-${blockIndex}-${nodes.length}`} className="list-disc space-y-2 pl-5">
        {items.map((item, itemIndex) => <li key={itemIndex}>{renderMarkdownListItem(item, `ul-${blockIndex}-${nodes.length}-${itemIndex}`)}</li>)}
      </ul>);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      const items: string[] = [];
      while (lineIndex < lines.length) {
        const itemMatch = lines[lineIndex].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        lineIndex += 1;
      }
      nodes.push(<ol key={`ol-${blockIndex}-${nodes.length}`} className="list-decimal space-y-2 pl-5">
        {items.map((item, itemIndex) => <li key={itemIndex}>{renderMarkdownListItem(item, `ol-${blockIndex}-${nodes.length}-${itemIndex}`)}</li>)}
      </ol>);
      continue;
    }

    paragraphLines.push(line);
    lineIndex += 1;
  }

  flushParagraph();
  return nodes;
};

type SalesImpactLevel = 'muito_baixo' | 'baixo' | 'medio' | 'alto' | 'muito_alto';

interface MarketingStructuredResponse {
  titulo: string;
  comentario: string;
  impactoAumentoVendas?: SalesImpactLevel;
  alterouCodigoRepositorio?: boolean;
  resumoCodigoPr: string;
  orientacaoProximaAcao: string;
  sugestaoMelhoriaAmbiente: string;
}

const tryParseMarketingResponseRecord = (candidate: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'string') {
      return tryParseMarketingResponseRecord(parsed);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const extractJsonObjectCandidate = (content: string): string | null => {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const parsedString = (() => {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  })();
  if (parsedString) {
    return extractJsonObjectCandidate(parsedString);
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  if (candidate !== trimmed) {
    return extractJsonObjectCandidate(candidate);
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
};

const readStructuredResponseString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
};

const readStructuredResponseBoolean = (record: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'sim', 'yes', '1'].includes(normalized)) return true;
      if (['false', 'nao', 'não', 'no', '0'].includes(normalized)) return false;
    }
  }
  return undefined;
};

const normalizeSalesImpactLevel = (value: string): SalesImpactLevel | undefined => {
  const normalized = value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const canonical = normalized.replace(/[\s-]+/g, '_');
  if (canonical === 'muito_baixo' || canonical === 'baixo' || canonical === 'medio' || canonical === 'alto' || canonical === 'muito_alto') {
    return canonical;
  }
  return undefined;
};

const readStructuredSalesImpactLevel = (record: Record<string, unknown>): SalesImpactLevel | undefined => {
  const value = readStructuredResponseString(record, [
    'impactoAumentoVendas',
    'impacto_aumento_vendas',
    'contribuicaoAumentoVendas',
    'contribuiçãoAumentoVendas',
    'contribuicao_vendas',
    'impactoVendas',
    'salesImpact'
  ]);
  return normalizeSalesImpactLevel(value);
};

const parseMarketingStructuredResponse = (content: string): MarketingStructuredResponse | null => {
  const candidate = extractJsonObjectCandidate(content);
  if (!candidate) return null;

  const record = tryParseMarketingResponseRecord(candidate);
  if (!record) {
    return null;
  }

  const titulo = readStructuredResponseString(record, ['titulo', 'título', 'title']).trim();
  const comentario = readStructuredResponseString(record, ['comentario', 'comentário', 'comment', 'resposta']).trim();
  const impactoAumentoVendas = readStructuredSalesImpactLevel(record);
  const alterouCodigoRepositorio = readStructuredResponseBoolean(record, [
    'alterouCodigoRepositorio',
    'alterou_codigo_repositorio',
    'codigoAlterado',
    'codeChanged',
    'changedRepositoryCode'
  ]);
  const resumoCodigoPr = readStructuredResponseString(record, [
    'resumoCodigoPr',
    'resumo_codigo_pr',
    'resumoPr',
    'prSummary',
    'codePrSummary'
  ]).trim();
  const orientacaoProximaAcao = readStructuredResponseString(record, [
    'orientacaoProximaAcao',
    'orientaçãoProximaAção',
    'orientacao_proxima_acao',
    'orientacao',
    'orientação',
    'nextActionGuidance'
  ]).trim();
  const sugestaoMelhoriaAmbiente = readStructuredResponseString(record, [
    'sugestaoMelhoriaAmbiente',
    'sugestãoMelhoriaAmbiente',
    'sugestao_melhoria_ambiente',
    'sugestaoAmbiente',
    'sugestãoAmbiente',
    'environmentImprovementSuggestion'
  ]).trim();
  if (!titulo && !comentario && alterouCodigoRepositorio === undefined && !resumoCodigoPr && !orientacaoProximaAcao && !sugestaoMelhoriaAmbiente) {
    return null;
  }
  return { titulo, comentario, impactoAumentoVendas, alterouCodigoRepositorio, resumoCodigoPr, orientacaoProximaAcao, sugestaoMelhoriaAmbiente };
};

const marketingResponseIndicatesCodeChange = (content?: string): boolean =>
  parseMarketingStructuredResponse(content ?? '')?.alterouCodigoRepositorio === true;

const parseMarketingStructuredTitle = (content?: string): string => {
  if (!content) return '';
  return parseMarketingStructuredResponse(content)?.titulo ?? '';
};

const resolveRequestHistoryTitle = (request: CodexRequest): string =>
  request.requestTitle || request.problemTitle || parseMarketingStructuredTitle(request.responseText);

const resolveRequestHistoryHeading = (request: CodexRequest): string =>
  request.status === 'COMPLETED'
    ? `#${request.id} · ${resolveRequestHistoryTitle(request)}`
    : `#${request.id}`;

const MarkdownMessage = ({ content }: { content: string }) => {
  const normalized = stripModelThinking(content);
  const blocks = normalized.split(/(```[\s\S]*?```)/g).filter((block) => block.length > 0);
  return <div className="space-y-2 whitespace-normal break-words">
    {blocks.map((block, blockIndex) => {
      const codeMatch = block.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
      if (codeMatch) {
        return <CopyableCodeBlock key={`code-${blockIndex}`} code={codeMatch[2].trimEnd()} />;
      }
      return renderMarkdownTextBlock(block, blockIndex);
    })}
  </div>;
};

const CopyableCodeBlock = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
  }, []);

  const handleCopy = async () => {
    await copyTextToClipboard(code);
    setCopied(true);
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 p-3 pr-11 text-xs text-slate-50 dark:border-slate-700"><code>{code}</code></pre>
      <button type="button" onClick={handleCopy} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-600 bg-slate-900 text-slate-200 shadow-sm transition hover:border-slate-400 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" aria-label={copied ? 'Código copiado' : 'Copiar código'} title={copied ? 'Código copiado' : 'Copiar código'}>
        {copied ? <span aria-hidden="true" className="text-sm font-semibold">✓</span> : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>}
      </button>
    </div>
  );
};

const CopyIcon = ({ copied }: { copied: boolean }) => (
  copied
    ? <span aria-hidden="true" className="text-sm font-semibold">✓</span>
    : (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    )
);

const CodeGeneratedIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
    <path d="m14.5 4-5 16" />
  </svg>
);

const CodeGeneratedBadge = () => (
  <span
    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
    title="Esta resposta indica que foram geradas ou alteradas mudanças no repositório"
  >
    <CodeGeneratedIcon />
    <span>Gerou código</span>
  </span>
);

const SalesImpactIcon = ({ level }: { level: SalesImpactLevel }) => {
  const styles: Record<SalesImpactLevel, string> = {
    muito_baixo: 'border-red-400 bg-red-600 dark:border-red-800',
    baixo: 'border-orange-300 bg-orange-500 dark:border-orange-700',
    medio: 'border-yellow-300 bg-yellow-400 dark:border-yellow-700',
    alto: 'border-lime-300 bg-lime-500 dark:border-lime-700',
    muito_alto: 'border-emerald-300 bg-emerald-600 dark:border-emerald-800'
  };
  const labels: Record<SalesImpactLevel, string> = {
    muito_baixo: 'Impacto em vendas: muito baixo',
    baixo: 'Impacto em vendas: baixo',
    medio: 'Impacto em vendas: médio',
    alto: 'Impacto em vendas: alto',
    muito_alto: 'Impacto em vendas: muito alto'
  };
  return (
    <span
      className={`inline-flex h-4 w-4 rounded-full border shadow-sm ${styles[level]}`}
      title={labels[level]}
      aria-label={labels[level]}
      role="img"
    />
  );
};

const CommentReadStatusBadge = ({ read }: { read: boolean }) => (
  <span
    title={read ? 'Comentário lido' : 'Comentário pendente de leitura'}
    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${
      read
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
    }`}
  >
    <span aria-hidden="true">{read ? '✓' : '!'}</span>
    <span>{read ? 'Lido' : 'Pendente'}</span>
  </span>
);

interface AssistantMessageBodyProps {
  content: string;
  structuredResponse: boolean;
  commentRead?: boolean;
  onCommentReadChange?: (read: boolean) => void;
  onDismissRequest?: () => void;
  isOrientationRequested: (orientation: string) => boolean;
  onRequestOrientation: (orientation: string) => void;
}

const AssistantMessageBody = ({ content, structuredResponse, commentRead = false, onCommentReadChange, onDismissRequest, isOrientationRequested, onRequestOrientation }: AssistantMessageBodyProps) => {
  const structured = structuredResponse ? parseMarketingStructuredResponse(content) : null;
  const [copiedField, setCopiedField] = useState<'comentario' | 'orientacao' | 'melhoria' | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const orientationRequested = structured?.orientacaoProximaAcao ? isOrientationRequested(structured.orientacaoProximaAcao) : false;

  useEffect(() => () => {
    if (copiedTimeoutRef.current) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
  }, []);

  const handleCopyStructuredText = useCallback(async (field: 'comentario' | 'orientacao' | 'melhoria', text?: string) => {
    if (!text) {
      return;
    }
    await copyTextToClipboard(text);
    setCopiedField(field);
    if (copiedTimeoutRef.current) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const handleRequestOrientation = useCallback(() => {
    if (!structured?.orientacaoProximaAcao) {
      return;
    }
    onRequestOrientation(structured.orientacaoProximaAcao);
  }, [onRequestOrientation, structured?.orientacaoProximaAcao]);

  if (!structured) {
    return <MarkdownMessage content={content} />;
  }
  const commentGeneratedCode = structured.alterouCodigoRepositorio === true;

  return <div className="space-y-3">
    {structured.titulo ? <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-sm dark:border-sky-900 dark:bg-sky-950/30">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Título</h4>
      <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">{structured.titulo}</p>
    </section> : null}
    {structured.comentario ? <section className={`rounded-lg border p-4 shadow-sm transition ${commentRead ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/10'}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Comentário</h4>
          {structured.impactoAumentoVendas ? <SalesImpactIcon level={structured.impactoAumentoVendas} /> : null}
          {commentGeneratedCode ? <CodeGeneratedBadge /> : null}
          {onCommentReadChange ? <CommentReadStatusBadge read={commentRead} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCommentReadChange ? <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold normal-case tracking-normal transition ${
            commentRead
              ? 'border-emerald-200 bg-white/80 text-emerald-700 hover:border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'border-amber-300 bg-white/90 text-amber-800 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
          }`}>
            <input
              type="checkbox"
              aria-label="Lido"
              checked={commentRead}
              onChange={(event) => onCommentReadChange(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>{commentRead ? 'Lido' : 'Marcar lido'}</span>
          </label> : null}
          {commentRead && onDismissRequest ? <button
            type="button"
            onClick={onDismissRequest}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white/80 text-slate-600 transition hover:border-rose-400 hover:bg-white hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:border-rose-500 dark:hover:text-rose-300"
            title="Retirar solicitação da tela"
            aria-label="Retirar solicitação da tela"
          >
            ×
          </button> : null}
          <button
            type="button"
            onClick={() => handleCopyStructuredText('comentario', structured.comentario)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white/80 text-slate-600 transition hover:border-slate-500 hover:bg-white hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
            title="Copiar comentário"
            aria-label="Copiar comentário"
          >
            <CopyIcon copied={copiedField === 'comentario'} />
          </button>
        </div>
      </div>
      <MarkdownMessage content={structured.comentario} />
    </section> : null}
    {structured.orientacaoProximaAcao ? <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/30">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Orientação</h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRequestOrientation}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${orientationRequested ? 'border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-400 dark:bg-emerald-500 dark:text-emerald-950' : 'border-emerald-300 bg-white/80 text-emerald-700 hover:border-emerald-500 hover:bg-white hover:text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:border-emerald-500 dark:hover:text-emerald-100'}`}
            title={orientationRequested ? 'Orientação já enviada para a solicitação' : 'Enviar orientação para a solicitação'}
            aria-label={orientationRequested ? 'Orientação já enviada para a solicitação' : 'Enviar orientação para a solicitação'}
            aria-pressed={orientationRequested}
          >
            {orientationRequested ? '✓' : '↪'}
          </button>
          <button
            type="button"
            onClick={() => handleCopyStructuredText('orientacao', structured.orientacaoProximaAcao)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-300 bg-white/80 text-emerald-700 transition hover:border-emerald-500 hover:bg-white hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:border-emerald-500 dark:hover:text-emerald-100"
            title="Copiar orientação"
            aria-label="Copiar orientação"
          >
            <CopyIcon copied={copiedField === 'orientacao'} />
          </button>
        </div>
      </div>
      <div className="text-emerald-950 dark:text-emerald-100">
        <MarkdownMessage content={structured.orientacaoProximaAcao} />
      </div>
    </section> : null}
    {structured.sugestaoMelhoriaAmbiente ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Sugestão de melhoria para o ambiente</h4>
        <button
          type="button"
          onClick={() => handleCopyStructuredText('melhoria', structured.sugestaoMelhoriaAmbiente)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-300 bg-white/80 text-amber-700 transition hover:border-amber-500 hover:bg-white hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:border-amber-500 dark:hover:text-amber-100"
          title="Copiar sugestão de melhoria"
          aria-label="Copiar sugestão de melhoria"
        >
          <CopyIcon copied={copiedField === 'melhoria'} />
        </button>
      </div>
      <div className="text-amber-950 dark:text-amber-100">
        <MarkdownMessage content={structured.sugestaoMelhoriaAmbiente} />
      </div>
    </section> : null}
  </div>;
};

const CHATGPT_CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-5.6', modelName: 'gpt-5.6', displayName: 'GPT-5.6' },
  { id: 'gpt-5.6-sol', modelName: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', modelName: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', modelName: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', modelName: 'gpt-5.5' },
  { id: 'gpt-5.4', modelName: 'gpt-5.4' }
];

const normalizeModelOption = (value: unknown): ModelOption | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const modelName = typeof record.modelName === 'string' && record.modelName.trim()
    ? record.modelName.trim()
    : typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : null;
  if (!modelName) {
    return null;
  }
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : modelName;
  const displayName = typeof record.displayName === 'string' && record.displayName.trim() ? record.displayName.trim() : undefined;
  return { id, modelName, displayName };
};

const mergeModelOptions = (primary: ModelOption[], fallback: ModelOption[]): ModelOption[] => {
  const byModel = new Map<string, ModelOption>();
  [...primary, ...fallback].forEach((item) => {
    if (!byModel.has(item.modelName)) {
      byModel.set(item.modelName, item);
    }
  });
  return Array.from(byModel.values());
};

const parseProductOption = (value: unknown): ProductOption | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'number' ? record.id : Number(record.id);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
  if (!Number.isFinite(id) || !name || !slug) {
    return null;
  }
  return { id, name, slug };
};

const sortProductOptions = (items: ProductOption[]) =>
  [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

const isImageAttachment = (attachment: FileAttachment): boolean => attachment.mimeType.startsWith('image/');

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  requestId?: number;
  environment?: string;
  status?: CodexRequest['status'];
  createdAt: string;
}

const chatConversationStorageKey = (profile: CodexProfile) => `${CHAT_CONVERSATION_STORAGE_PREFIX}${profile}`;

const parsePersistedChatMessage = (value: unknown): ChatMessage | null => {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : item.role === 'system' ? 'system' : null;
  const content = typeof item.content === 'string' ? item.content : '';
  const id = typeof item.id === 'string' ? item.id : '';
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : '';
  const requestId = typeof item.requestId === 'number' && Number.isFinite(item.requestId) ? item.requestId : undefined;
  const environment = typeof item.environment === 'string' && item.environment.trim() ? item.environment.trim() : undefined;
  const status = typeof item.status === 'string' && ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(item.status)
    ? item.status as CodexRequest['status']
    : undefined;
  return role && content.trim() && id && createdAt ? { id, role, content, requestId, environment, status, createdAt } : null;
};

const loadPersistedChatConversation = (profile: CodexProfile): ChatMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(chatConversationStorageKey(profile));
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map(parsePersistedChatMessage).filter((message): message is ChatMessage => message !== null)
      : [];
  } catch {
    return [];
  }
};

const resolveAssistantMessageTimestamp = (request: CodexRequest, currentCreatedAt?: string) => {
  if (!isTerminalStatus(request.status)) {
    return currentCreatedAt ?? request.createdAt ?? new Date().toISOString();
  }

  return request.finishedAt ?? currentCreatedAt ?? new Date().toISOString();
};

const buildPrRequestMarkerContent = (url?: string, title?: string) => {
  const label = title?.trim() || 'Abrir PR solicitado';
  if (url?.trim()) {
    return `Pedido de PR registrado no lote. [${label}](${url.trim()})`;
  }
  return `Pedido de PR registrado no lote. ${label}`;
};

const buildPostPrContinuationPrompt = (prUrl?: string, environment?: string) => [
  'Continue esta solicitação até ela ficar completamente resolvida.',
  prUrl?.trim() ? `O PR do lote já foi criado em ${prUrl.trim()}.` : 'O PR do lote já foi solicitado.',
  'Considere que o usuário aprovou ou está acompanhando o PR pelo GitHub e quer evitar recomeçar contexto em uma nova solicitação.',
  'Verifique o estado atual do repositório, do PR/deploy e da funcionalidade afetada usando as ferramentas disponíveis.',
  'Se o PR ainda não tiver sido aprovado, mergeado ou deployado, explique objetivamente o bloqueio e qual validação deve ser feita depois da publicação.',
  'Se a alteração já estiver publicada, valide como usuário final quando possível, identifique o que ainda falta para resolver o pedido original e implemente os ajustes restantes no mesmo fluxo.',
  environment?.trim() ? `Ambiente/repositório selecionado: ${environment.trim()}.` : ''
].filter(Boolean).join('\n');

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
const RESPONSE_READY_MELODY_QUEUED_REPETITIONS = 1;
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

const playResponseReadyBeep = (repetitions = RESPONSE_READY_MELODY_REPETITIONS) => {
  const audioContext = getResponseReadyAudioContext();
  if (!audioContext || !responseReadyAudioUnlocked) return;

  const now = audioContext.currentTime;
  const noteDurationSeconds = RESPONSE_READY_NOTE_DURATION_MS / 1000;
  const noteStepSeconds = (RESPONSE_READY_NOTE_DURATION_MS + RESPONSE_READY_NOTE_GAP_MS) / 1000;
  const repeatStepSeconds =
    RESPONSE_READY_MELODY_FREQUENCIES_HZ.length * noteStepSeconds + RESPONSE_READY_MELODY_REPEAT_GAP_MS / 1000;

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
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
      const hasQueuedOrRunningRequest = Array.from(nextStatuses.values()).some((status) => !isTerminalStatus(status));
      if (!hasQueuedOrRunningRequest) {
        showMarker();
      }
      playResponseReadyBeep(hasQueuedOrRunningRequest ? RESPONSE_READY_MELODY_QUEUED_REPETITIONS : RESPONSE_READY_MELODY_REPETITIONS);
    }
  }, [conversation, showMarker]);
};

interface CodexChatgptPageProps {
  variant?: 'default' | 'marketing' | 'sandbox';
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

const CODEX_CHATGPT_OPERATIONAL_INSTRUCTION = 'Orientação importante para perfis Codex ChatGPT: quando a solicitação for criar um artefato dentro do Marketing Hub, faça isso pelo front-end do sistema; se o front-end ainda não tiver a funcionalidade necessária, implemente essa funcionalidade, avise o usuário e aguarde o deploy antes de criar o artefato por esse caminho; quando a solicitação for alterar uma funcionalidade de módulo, altere o código do repositório, valide e deixe a mudança pronta para aguardar o deploy. Nunca use SSH para publicar diretamente uma alteração.';
const CODEX_CHATGPT_BROWSER_TESTING_INSTRUCTION = 'A sandbox dos modelos possui Playwright e @playwright/test instalados, com Chromium em /usr/bin/chromium e variáveis de navegador configuradas. A melhor opção de simulador de celular disponível na sandbox é o Playwright com emulação mobile do Chromium, usando dispositivos de @playwright/test como devices["iPhone 15 Pro"] ou devices["Pixel 7"]; sempre que precisar testar uma URL como usuário de celular, use esse recurso para abrir a página com viewport, user agent, touch e deviceScaleFactor de celular, gerar screenshots e validar interações. Para vídeos, áudio e animações em mobile, combine essa emulação com sandbox-media-player, ffmpeg e ffprobe para testar reprodução, duração, frames, sincronia, controles nativos e comportamento visual no layout mobile.';
const CODEX_CHATGPT_MEDIA_TOOLS_INSTRUCTION = 'A sandbox dos modelos possui ffmpeg e ffprobe disponíveis pelos comandos ffmpeg e ffprobe; quando a solicitação envolver vídeos, use ffmpeg para converter, cortar, extrair áudio, gerar thumbnails e sintetizar mídias de teste, e use ffprobe para inspecionar metadados, codecs, resolução, duração, streams e integridade básica. O comando sandbox-media-player <arquivo-video-ou-audio> [saida.html] gera um player HTML local com controles nativos de vídeo/áudio; abra o HTML com Chromium/Playwright para reproduzir a mídia e avaliar naturalidade da pronúncia, sincronização labial, cortes e qualidade perceptual além da validação técnica.';

const DEFAULT_VARIANT_CONFIG: CodexChatgptVariantConfig = {
  profile: 'CHATGPT_CODEX',
  title: 'Codex ChatGPT Managed',
  formTitle: 'Conversa interativa (Fase 2)',
  description: 'Envie uma solicitação, continue refinando no mesmo diálogo e use o fluxo pós-PR para validar deploy sem reconstruir contexto.',
  historyTitle: 'Últimas execuções ChatGPT',
  placeholder: 'Digite sua mensagem para o modelo... Cole prints com Ctrl+V. O diálogo continua mesmo depois do PR.',
  promptModeLine: 'Você está em uma conversa interativa da Fase 2 do Codex ChatGPT Managed.',
  promptExtraLines: [
    'Você pode executar qualquer módulo do repositório no próprio ambiente para testar e ajustar a solução, respeitando as ferramentas e credenciais disponíveis.',
    'Toda alteração de código feita pelo modelo precisa passar por um Pull Request executado pelo usuário antes de ser publicada. O modelo pode testar tudo no próprio ambiente, mas qualquer imagem usada em produção deve ser criada obrigatoriamente pelo código, Dockerfile, Compose ou pipeline versionados neste repositório; não publique nem recomende imagem de produção gerada manualmente fora do fluxo do repositório.',
    CODEX_CHATGPT_OPERATIONAL_INSTRUCTION,
    CODEX_CHATGPT_MEDIA_TOOLS_INSTRUCTION,
    CODEX_CHATGPT_BROWSER_TESTING_INSTRUCTION
  ]
};

const MARKETING_VARIANT_CONFIG: CodexChatgptVariantConfig = {
  profile: 'CHATGPT_CODEX_MKT',
  title: 'Codex ChatGPT MKT',
  formTitle: 'Análise de relatórios de marketing',
  description: 'Envie uma solicitação, refine a análise no mesmo diálogo e use o fluxo pós-PR para validar deploy sem reconstruir contexto.',
  historyTitle: 'Últimas execuções ChatGPT MKT',
  placeholder: 'Digite sua solicitação de análise de marketing... Ex.: avalie campanhas, estratégias, canais, resultados e gere orientações de melhoria.',
  promptModeLine: 'Você está em uma conversa interativa da Fase 2 do Codex ChatGPT Managed no modo MKT.',
  promptExtraLines: [
    'Nosso objetivo principal é gerar vendas em larga escala de produtos digitais de alto valor com comunicação sedutora pelo sistema Marketing Hub.',
    'Use a sandbox para baixar e analisar o repositório como uma base de relatórios de marketing, principalmente arquivos Markdown.',
    'Você pode executar qualquer módulo do repositório no próprio ambiente para testar e ajustar a solução, respeitando as ferramentas e credenciais disponíveis.',
    'Toda alteração de código feita pelo modelo precisa passar por um Pull Request executado pelo usuário antes de ser publicada. O modelo pode testar tudo no próprio ambiente, mas qualquer imagem usada em produção deve ser criada obrigatoriamente pelo código, Dockerfile, Compose ou pipeline versionados neste repositório; não publique nem recomende imagem de produção gerada manualmente fora do fluxo do repositório.',
    CODEX_CHATGPT_OPERATIONAL_INSTRUCTION,
    CODEX_CHATGPT_MEDIA_TOOLS_INSTRUCTION,
    CODEX_CHATGPT_BROWSER_TESTING_INSTRUCTION,
    'No lugar de atuar como programação, atue como analista de marketing digital: campanhas, estratégias, funis, canais, criativos, métricas, resultados, aprendizados e oportunidades.',
    'Gere relatórios de orientação com melhorias acionáveis para o usuário e preserve evidências dos arquivos analisados.',
    'Só crie ou prepare Pull Request quando o usuário pedir explicitamente o PR ou usar o botão Pedir PR.',
    'Na resposta final, responda somente com JSON válido no formato {"titulo":"<título muito curto, uma frase simples>","comentario":"<resposta principal em Markdown>","impactoAumentoVendas":"medio","alterouCodigoRepositorio":false,"resumoCodigoPr":"","sugestaoMelhoriaAmbiente":"<sugestão de recurso ou ferramenta que teria permitido fazer um trabalho melhor durante a solicitação, ou string vazia se o ambiente já foi suficiente>"}. O campo "impactoAumentoVendas" é obrigatório e deve indicar se esta solicitação contribui para aumentar vendas, usando exclusivamente um dos cinco níveis: "muito_baixo", "baixo", "medio", "alto" ou "muito_alto". Use "muito_alto" quando a entrega atuar diretamente em uma alavanca central de receita ou conversão com alto potencial mensurável; use "alto" quando mexer diretamente em oferta, funil, copy, criativos, segmentação, checkout, recuperação ou campanhas; use "medio" quando melhorar análise, operação, instrumentação ou uma etapa indireta do crescimento; use "baixo" quando o efeito comercial for pequeno e distante; use "muito_baixo" quando for ajuste técnico, organização ou investigação sem conexão comercial relevante. O campo "alterouCodigoRepositorio" é obrigatório e deve ser true somente quando você tiver criado, removido ou alterado arquivos de código/configuração/testes/documentação versionada no repositório; use false quando tiver feito apenas análise, orientação ou leitura. O campo "resumoCodigoPr" é obrigatório e deve conter um resumo muito curto, em uma frase, das mudanças de código para entrar no PR; use string vazia quando "alterouCodigoRepositorio" for false. O campo opcional "orientacaoProximaAcao" deve ser incluído somente quando existir uma ação efetiva do usuário necessária para concluir a solicitação, como decidir entre alternativas, aprovar algo, fornecer acesso ou executar uma etapa fora da sandbox; quando a solicitação já tiver sido implementada ou não houver ação necessária do usuário, omita esse campo. Use comentario para a resposta normal e sugestaoMelhoriaAmbiente apenas para melhoria do ambiente de execução.'
  ]
};

const SANDBOX_VARIANT_CONFIG: CodexChatgptVariantConfig = {
  profile: 'CHATGPT_CODEX_SANDBOX',
  title: 'Codex ChatGPT Sandbox',
  formTitle: 'Execução direta na sandbox',
  description: 'Envie uma solicitação para o Codex executar dentro da sandbox do modelo, sem Git, sem repositório e sem Pull Request.',
  historyTitle: 'Últimas execuções ChatGPT Sandbox',
  placeholder: 'Digite o que o modelo deve executar na sandbox... Ex.: gere um arquivo temporário, valide uma ideia, rode um comando seguro ou analise um anexo.',
  promptModeLine: 'Você está em uma conversa interativa do Codex ChatGPT Sandbox.',
  promptExtraLines: [
    'Execute solicitações do usuário dentro da sandbox do modelo, sem integração com Git e sem uso de repositório.',
    'Não clone repositórios, não gere diff, não prepare branch e não crie Pull Request.',
    CODEX_CHATGPT_OPERATIONAL_INSTRUCTION,
    CODEX_CHATGPT_MEDIA_TOOLS_INSTRUCTION,
    CODEX_CHATGPT_BROWSER_TESTING_INSTRUCTION,
    'Use o diretório temporário da sandbox apenas como área de trabalho descartável para comandos, arquivos auxiliares e anexos.',
    'Responda em português de forma objetiva e acionável.'
  ]
};

const resolveVariantConfig = (variant: CodexChatgptPageProps['variant']): CodexChatgptVariantConfig =>
  variant === 'marketing'
    ? MARKETING_VARIANT_CONFIG
    : variant === 'sandbox'
      ? SANDBOX_VARIANT_CONFIG
      : DEFAULT_VARIANT_CONFIG;

interface TelemetryEvent {
  id: string;
  type: 'poll_success' | 'poll_error' | 'login_started' | 'login_failed' | 'logout_success' | 'logout_failed' | 'execution_success' | 'execution_failed' | 'pr_queued' | 'pr_blocked';
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
  const [products, setProducts] = useState<ProductOption[]>([]);
  const showProductSelector = config.profile === 'CHATGPT_CODEX_MKT';
  const sandboxOnly = config.profile === 'CHATGPT_CODEX_SANDBOX';
  const selectedEnvironment = sandboxOnly ? SANDBOX_ONLY_ENVIRONMENT : environment;
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProductSlug, setSelectedProductSlug] = useState('');
  const [promptHints, setPromptHints] = useState<PromptHintOption[]>([]);
  const [selectedPromptHintIds, setSelectedPromptHintIds] = useState<number[]>([]);
  const [promptHintsError, setPromptHintsError] = useState<string | null>(null);
  const [loadingPromptHints, setLoadingPromptHints] = useState(false);
  const [requests, setRequests] = useState<ReturnType<typeof parseCodexRequests>>([]);
  const [dailyMetrics, setDailyMetrics] = useState<CodexDashboardMetrics | null>(null);
  const [interactionIsStale, setInteractionIsStale] = useState(false);
  const [, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [accountApiAvailable, setAccountApiAvailable] = useState(true);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLoginState | null>(null);
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  const [conversation, setConversation] = useState<ChatMessage[]>(() => loadPersistedChatConversation(config.profile));
  const [prLoading, setPrLoading] = useState(false);
  const [bulkDiscardLoading, setBulkDiscardLoading] = useState(false);
  const [prResult, setPrResult] = useState<{ url?: string; title?: string } | null>(null);
  const [deletingRequestId, setDeletingRequestId] = useState<number | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<number | null>(null);
  const [ratingRequestId, setRatingRequestId] = useState<number | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [savingEditRequestId, setSavingEditRequestId] = useState<number | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [selectedSavedConversationId, setSelectedSavedConversationId] = useState<number | ''>('');
  const [selectedSavedConversationMessages, setSelectedSavedConversationMessages] = useState<SavedConversationMessage[]>([]);
  const [savingConversation, setSavingConversation] = useState(false);
  const [deletingSavedConversation, setDeletingSavedConversation] = useState(false);
  const [requestedOrientations, setRequestedOrientations] = useState<Set<string>>(() => new Set());
  const [readCommentIds, setReadCommentIds] = useState<Set<string>>(() => loadReadCommentIds(config.profile));
  const [hiddenRequestIds, setHiddenRequestIds] = useState<Set<number>>(() => loadHiddenRequestIds(config.profile));
  const conversationPollInFlight = useRef(false);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationMessageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const interactionActivityRef = useRef<{ startsAt: string; count: number } | null>(null);
  const interactionStaleTimeoutRef = useRef<number | null>(null);

  useModelResponseTabMarker(conversation, config.title);

  useEffect(() => () => {
    if (copiedMessageTimeoutRef.current) {
      window.clearTimeout(copiedMessageTimeoutRef.current);
    }
  }, []);

  useEffect(() => () => {
    if (interactionStaleTimeoutRef.current) {
      window.clearTimeout(interactionStaleTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    try {
      const key = chatConversationStorageKey(config.profile);
      if (conversation.length === 0) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(conversation));
    } catch {
      // A conversa continua na sessão atual caso o navegador bloqueie ou limite o armazenamento local.
    }
  }, [config.profile, conversation]);

  useEffect(() => {
    try {
      window.localStorage.setItem(readCommentsStorageKey(config.profile), JSON.stringify([...readCommentIds]));
    } catch {
      // O estado continua disponível na sessão atual caso o armazenamento local esteja indisponível.
    }
  }, [config.profile, readCommentIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(hiddenRequestsStorageKey(config.profile), JSON.stringify([...hiddenRequestIds]));
    } catch {
      // A ocultação continua disponível na sessão atual caso o armazenamento local esteja indisponível.
    }
  }, [config.profile, hiddenRequestIds]);

  const handleCommentReadChange = useCallback((messageId: string, read: boolean) => {
    setReadCommentIds((current) => {
      const next = new Set(current);
      if (read) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  }, []);

  const handleDismissConversationRequest = useCallback((requestId: number) => {
    setHiddenRequestIds((current) => {
      const next = new Set(current);
      next.add(requestId);
      return next;
    });
  }, []);

  const handleRestoreHiddenRequests = useCallback(() => {
    setHiddenRequestIds(new Set());
  }, []);

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

  const handlePromptHintToggle = useCallback((hint: PromptHintOption, checked: boolean) => {
    if (normalizePromptHintType(hint.type) === 'text') {
      setPrompt((current) => checked ? appendPromptText(current, hint.phrase) : removePromptText(current, hint.phrase));
      window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
    }
    setSelectedPromptHintIds((current) => {
      const hintId = hint.id;
      if (checked) {
        return current.includes(hintId) ? current : [...current, hintId];
      }
      return current.filter((id) => id !== hintId);
    });
  }, []);

  const handleResetPrompt = useCallback(() => {
    setPrompt('');
    const textHintIds = new Set(
      promptHints
        .filter((hint) => normalizePromptHintType(hint.type) === 'text')
        .map((hint) => hint.id)
    );
    setSelectedPromptHintIds((current) => current.filter((id) => !textHintIds.has(id)));
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }, [promptHints]);

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
      const response = await client.get('/codex/requests', { params: { page: 0, size: 20 } });
      const parsed = parseCodexRequests(response.data).filter((item) => item.profile === config.profile);
      let nextRequests = parsed;
      const activeRequests = parsed.filter((item) => !isTerminalStatus(item.status) && item.externalId);
      if (activeRequests.length > 0) {
        const detailResponses = await Promise.allSettled(
          activeRequests.map((item) => client.get(`/codex/requests/${item.id}`))
        );
        const detailedRequests = detailResponses
          .map((result) => result.status === 'fulfilled' ? parseCodexRequest(result.value.data) : null)
          .filter((item): item is CodexRequest => item !== null && item.profile === config.profile);
        if (detailedRequests.length > 0) {
          const detailedById = new Map(detailedRequests.map((item) => [item.id, item]));
          nextRequests = parsed.map((item) => mergeCodexRequestItem(item, detailedById.get(item.id) ?? item));
        }
      }

      setRequests((current) => mergeCodexRequestList(current, nextRequests));
      return nextRequests;
    } finally {
      setRequestsLoading(false);
    }
  }, [config.profile]);

  const loadDailyMetrics = useCallback(async () => {
    const response = await client.get<CodexDashboardMetrics>('/codex/requests/metrics', {
      params: { profile: config.profile }
    });
    const observedDay = response.data?.day;
    if (observedDay && Number.isFinite(observedDay.interactionCount)) {
      const previous = interactionActivityRef.current;
      if (!previous || previous.startsAt !== observedDay.startsAt || previous.count !== observedDay.interactionCount) {
        interactionActivityRef.current = { startsAt: observedDay.startsAt, count: observedDay.interactionCount };
        setInteractionIsStale(false);
        if (interactionStaleTimeoutRef.current) {
          window.clearTimeout(interactionStaleTimeoutRef.current);
        }
        if (config.profile === 'CHATGPT_CODEX_MKT') {
          interactionStaleTimeoutRef.current = window.setTimeout(() => {
            setInteractionIsStale(true);
          }, INTERACTION_STALE_ALERT_MS);
        }
      }
    }
    setDailyMetrics(response.data);
    return response.data;
  }, [config.profile]);

  const loadSavedConversations = useCallback(async () => {
    const response = await client.get('/codex/conversations', { params: { profile: config.profile } });
    const parsed = parseSavedConversations(response.data).filter((item) => item.profile === config.profile);
    setSavedConversations(parsed);
    return parsed;
  }, [config.profile]);

  const loadProducts = useCallback(async () => {
    if (config.profile !== 'CHATGPT_CODEX_MKT') {
      setProducts([]);
      setSelectedProductSlug('');
      return [];
    }
    setProductsLoading(true);
    try {
      const response = await client.get('/products');
      const parsed = sortProductOptions(
        (Array.isArray(response.data) ? response.data : [])
          .map(parseProductOption)
          .filter((item): item is ProductOption => item !== null)
      );
      setProducts(parsed);
      setSelectedProductSlug((current) => current && parsed.some((item) => item.slug === current) ? current : '');
      return parsed;
    } finally {
      setProductsLoading(false);
    }
  }, [config.profile]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [accountResult, envResponse] = await Promise.all([
        client.get('/account/read').then((response) => ({ ok: true as const, data: response.data })).catch((err) => ({ ok: false as const, error: err as Error })),
        client.get<EnvironmentOption[]>('/environments')
      ]);
      const modelResponse = await client.get('/account/models')
        .then((response) => Array.isArray(response.data) ? response.data.map(normalizeModelOption).filter((item): item is ModelOption => item !== null) : [])
        .catch(() => []);
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
      const nextModels = mergeModelOptions(modelResponse, CHATGPT_CODEX_MODELS);
      setModels(nextModels);
      setEnvironment((current) => current || envResponse.data[0]?.name || '');
      setModel((current) => nextModels.some((item) => item.modelName === current) ? current : nextModels[0]?.modelName ?? '');
      await Promise.all([loadRequests(), loadSavedConversations(), loadProducts(), loadDailyMetrics()]);
      registerTelemetry('poll_success', 'Leitura de conta e execuções atualizada com sucesso.');
      setError(null);
    } catch (err) {
      registerTelemetry('poll_error', `Falha no bootstrap/polling: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadDailyMetrics, loadProducts, loadRequests, loadSavedConversations, registerTelemetry]);

  useEffect(() => {
    loadBootstrap().catch(() => undefined);
  }, [loadBootstrap]);

  useEffect(() => {
    const interval = setInterval(() => {
      Promise.all([loadRequests(), loadAccount(), loadDailyMetrics()])
        .then(() => registerTelemetry('poll_success', 'Polling periódico concluído.'))
        .catch((err: Error) => registerTelemetry('poll_error', `Falha no polling periódico: ${err.message}`));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAccount, loadDailyMetrics, loadRequests, registerTelemetry]);

  useEffect(() => {
    const trimmedEnvironment = selectedEnvironment.trim();
    if (!trimmedEnvironment) {
      setPromptHints([]);
      setSelectedPromptHintIds([]);
      setPromptHintsError(null);
      setLoadingPromptHints(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingPromptHints(true);
    client
      .get<PromptHintOption[]>('/prompt-hints', {
        params: { environment: trimmedEnvironment }
      })
      .then((response) => {
        if (cancelled) return;
        setPromptHints(response.data);
        setPromptHintsError(null);
        setSelectedPromptHintIds((current) => current.filter((id) => response.data.some((hint) => hint.id === id)));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPromptHintsError(err.message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPromptHints(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEnvironment]);

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


  const readAttachmentFile = useCallback((file: File): Promise<FileAttachment> => new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_ATTACHMENT_BYTES) {
      reject(new Error(`O arquivo ${file.name || 'sem nome'} excede o limite de 5 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Não foi possível ler o arquivo ${file.name || 'sem nome'}.`));
        return;
      }
      resolve({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || `arquivo-${Date.now()}`,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: reader.result
      });
    };
    reader.onerror = () => reject(new Error(`Falha ao ler o arquivo ${file.name || 'sem nome'}.`));
    reader.readAsDataURL(file);
  }), []);

  const appendAttachmentFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const slotsAvailable = MAX_FILE_ATTACHMENTS - fileAttachments.length;
    if (slotsAvailable <= 0) {
      setError(`Limite de ${MAX_FILE_ATTACHMENTS} arquivos por solicitação atingido.`);
      return;
    }
    try {
      const nextAttachments = await Promise.all(files.slice(0, slotsAvailable).map(readAttachmentFile));
      setFileAttachments((current) => [...current, ...nextAttachments]);
      setError(files.length > slotsAvailable ? `Foram anexados ${slotsAvailable} arquivos; o limite é ${MAX_FILE_ATTACHMENTS}.` : null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [fileAttachments.length, readAttachmentFile]);

  const handlePromptPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void appendAttachmentFiles(files);
  }, [appendAttachmentFiles]);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void appendAttachmentFiles(files);
  }, [appendAttachmentFiles]);

  const removeFileAttachment = useCallback((id: string) => {
    setFileAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const conversationMessagesMatchSavedContext = useCallback((historyMessages: ChatMessage[]) => {
    if (selectedSavedConversationMessages.length === 0 || selectedSavedConversationMessages.length > historyMessages.length) {
      return false;
    }
    return selectedSavedConversationMessages.every((savedMessage, index) => {
      const historyMessage = historyMessages[index];
      return historyMessage
        && savedMessage.role === historyMessage.role
        && savedMessage.content.trim() === historyMessage.content.trim();
    });
  }, [selectedSavedConversationMessages]);

  const selectedPromptHints = useMemo(() => {
    if (promptHints.length === 0 || selectedPromptHintIds.length === 0) {
      return [];
    }
    const hintsById = new Map(promptHints.map((hint) => [hint.id, hint]));
    return selectedPromptHintIds
      .map((id) => hintsById.get(id))
      .filter((hint): hint is PromptHintOption => Boolean(hint));
  }, [promptHints, selectedPromptHintIds]);

  const generalPromptHints = useMemo(
    () => promptHints.filter((hint) => !hint.environmentId),
    [promptHints]
  );

  const scopedPromptHints = useMemo(
    () => promptHints.filter((hint) => hint.environmentId),
    [promptHints]
  );

  const buildConversationPromptFromHistory = useCallback((message: string, historyMessages: ChatMessage[]) => {
    const savedContextMessages = conversationMessagesMatchSavedContext(historyMessages)
      ? []
      : selectedSavedConversationMessages;
    const promptHistoryMessages = [
      ...savedContextMessages.map((item) => ({ role: item.role, content: item.content })),
      ...historyMessages
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .map((item) => ({ role: item.role, content: item.content }))
    ];
    const history = promptHistoryMessages.map((item) => `${item.role === 'user' ? 'Usuário' : 'Modelo'}: ${item.content}`).join('\n\n');
    const selectedConversation = selectedSavedConversationId
      ? savedConversations.find((item) => item.id === selectedSavedConversationId)
      : undefined;
    const selectedProduct = selectedProductSlug
      ? products.find((item) => item.slug === selectedProductSlug)
      : undefined;
    const productSourceInstruction = selectedProduct
      ? `Antes de começar leia o documento em http://191.252.181.168:8000/api/products/public/${selectedProduct.slug}/marketing-definition.md e use como fonte de verdade sobre o PDE.`
      : '';
    const selectedPromptHintPhrases = selectedPromptHints
      .filter((hint) => normalizePromptHintType(hint.type) === 'prompt')
      .map((hint) => hint.phrase.trim())
      .filter((value) => value.length > 0);
    return [
      productSourceInstruction,
      config.promptModeLine,
      'Responda à última mensagem do usuário e mantenha contexto das mensagens anteriores.',
      'Não crie Pull Request até o usuário pedir explicitamente o PR ou até o botão Pedir PR ser usado.',
      ...config.promptExtraLines,
      selectedConversation ? `Contexto selecionado pelo usuário: conversa salva "${selectedConversation.title}" (${selectedConversation.messageCount} mensagem(ns), atualizada em ${formatDateTime(selectedConversation.updatedAt)}).` : '',
      history ? `Histórico da conversa:\n${history}` : '',
      selectedPromptHintPhrases.length > 0 ? `Contexto prioritário selecionado pelo usuário. Use estes itens para interpretar e responder a próxima mensagem:\n${selectedPromptHintPhrases.join('\n')}` : '',
      `Última mensagem do usuário:\n${message}`
    ].filter(Boolean).join('\n\n');
  }, [config.promptExtraLines, config.promptModeLine, conversationMessagesMatchSavedContext, products, savedConversations, selectedProductSlug, selectedPromptHints, selectedSavedConversationId, selectedSavedConversationMessages]);

  const buildConversationPrompt = useCallback((message: string) => buildConversationPromptFromHistory(message, conversation), [buildConversationPromptFromHistory, conversation]);

  const extractAssistantContent = useCallback((request: CodexRequest) => request.responseText || request.executionLog || (request.status === 'FAILED'
    ? 'A execução falhou. Abra os detalhes para ver os logs.'
    : request.status === 'CANCELLED'
      ? `Solicitação #${request.id} cancelada. Nenhuma nova resposta será gerada para esta mensagem.`
      : 'Resposta ainda não disponível.'), []);

  const hiddenConversationMessageIds = useMemo(() => {
    const ids = new Set<string>();
    conversation.forEach((message, index) => {
      if (message.role !== 'assistant' || !message.requestId || !hiddenRequestIds.has(message.requestId)) {
        return;
      }
      ids.add(message.id);
      const previousMessage = conversation[index - 1];
      if (previousMessage?.role === 'user') {
        ids.add(previousMessage.id);
      }
    });
    return ids;
  }, [conversation, hiddenRequestIds]);
  const visibleConversationPool = useMemo(
    () => conversation.filter((message) => !hiddenConversationMessageIds.has(message.id)),
    [conversation, hiddenConversationMessageIds]
  );
  const dismissedConversationMessageCount = conversation.length - visibleConversationPool.length;
  const dismissedRequestCount = useMemo(() => {
    const requestIds = new Set<number>();
    conversation.forEach((message) => {
      if (message.role === 'assistant' && message.requestId && hiddenRequestIds.has(message.requestId)) {
        requestIds.add(message.requestId);
      }
    });
    return requestIds.size;
  }, [conversation, hiddenRequestIds]);
  const visibleConversation = visibleConversationPool.slice(-MAX_VISIBLE_CONVERSATION_MESSAGES);
  const hiddenConversationMessages = Math.max(0, visibleConversationPool.length - visibleConversation.length);
  const firstUnreadModelResponseId = useMemo(() => {
    if (config.profile !== 'CHATGPT_CODEX_MKT') {
      return null;
    }
    const firstUnreadMessage = visibleConversation.find((message) =>
      message.role === 'assistant'
      && !readCommentIds.has(message.id)
      && Boolean(parseMarketingStructuredResponse(message.content)?.comentario)
    );
    return firstUnreadMessage?.id ?? null;
  }, [config.profile, readCommentIds, visibleConversation]);
  const activeConversationRequestCount = useMemo(() => new Set(conversation
    .filter((message) => message.role === 'assistant'
      && message.requestId
      && message.status
      && !isTerminalStatus(message.status))
    .map((message) => message.requestId as number)).size, [conversation]);
  const requestEnvironmentById = useMemo(
    () => new Map(requests.map((item) => [item.id, item.environment])),
    [requests]
  );
  const promptComposerDisabled = config.profile === 'CHATGPT_CODEX_MKT'
    && activeConversationRequestCount >= MAX_ACTIVE_CONVERSATION_REQUESTS;
  const promptComposerDisabledReason = promptComposerDisabled
    ? `Aguarde: as ${MAX_ACTIVE_CONVERSATION_REQUESTS} posições estão ocupadas por solicitações pendentes ou em processamento.`
    : '';

  const updateAssistantFromRequest = useCallback((request: CodexRequest) => {
    const responseContent = isTerminalStatus(request.status) ? extractAssistantContent(request) : '';
    setConversation((current) => current.map((message) => {
      if (message.role !== 'assistant' || message.requestId !== request.id) return message;
      const becameTerminal = !message.status || !isTerminalStatus(message.status);
      return {
        ...message,
        environment: request.environment,
        status: request.status,
        content: isTerminalStatus(request.status) ? responseContent : `Aguardando resposta do modelo... (${formatStatus(request.status)})`,
        createdAt: isTerminalStatus(request.status) && becameTerminal
          ? resolveAssistantMessageTimestamp(request)
          : resolveAssistantMessageTimestamp(request, message.createdAt)
      };
    }));
  }, [extractAssistantContent]);

  const handleSelectSavedConversation = useCallback(async (value: string) => {
    const nextId = value ? Number(value) : '';
    if (nextId === '') {
      setSelectedSavedConversationId('');
      setSelectedSavedConversationMessages([]);
      return;
    }
    if (!Number.isFinite(nextId)) {
      return;
    }
    try {
      const response = await client.get(`/codex/conversations/${nextId}`);
      const parsed = parseSavedConversation(response.data);
      if (!parsed) {
        throw new Error('Conversa salva inválida retornada pelo servidor.');
      }
      setSelectedSavedConversationId(parsed.id);
      setSelectedSavedConversationMessages(parsed.messages);
      if (parsed.environment && environments.some((item) => item.name === parsed.environment)) {
        setEnvironment(parsed.environment);
      }
      if (parsed.model && models.some((item) => item.modelName === parsed.model)) {
        setModel(parsed.model);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [environments, models]);

  const handleSaveConversation = useCallback(async () => {
    if (savingConversation) return;
    const messages = conversation
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
      .map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }));
    if (messages.length === 0) {
      setError('Não há diálogo para salvar ainda.');
      return;
    }
    const firstUserMessage = messages.find((message) => message.role === 'user')?.content ?? 'Conversa Codex';
    const title = firstUserMessage.replace(/\s+/g, ' ').trim().slice(0, 72) || 'Conversa Codex';
    setSavingConversation(true);
    try {
      const response = await client.post('/codex/conversations', {
        title,
        environment: selectedEnvironment,
        model,
        profile: config.profile,
        messages
      });
      const saved = parseSavedConversation(response.data);
      const latest = await loadSavedConversations();
      if (saved) {
        setSelectedSavedConversationId(saved.id);
        setSelectedSavedConversationMessages(saved.messages);
      } else if (latest.length > 0) {
        setSelectedSavedConversationId(latest[0].id);
        setSelectedSavedConversationMessages([]);
      }
      registerTelemetry('execution_success', 'Conversa salva para retomada futura.');
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao salvar conversa: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setSavingConversation(false);
    }
  }, [config.profile, conversation, loadSavedConversations, model, registerTelemetry, savingConversation, selectedEnvironment]);

  const handleDeleteSavedConversation = useCallback(async () => {
    if (!selectedSavedConversationId || deletingSavedConversation) return;
    const selectedConversation = savedConversations.find((item) => item.id === selectedSavedConversationId);
    const confirmed = window.confirm(`Apagar a conversa salva "${selectedConversation?.title ?? `#${selectedSavedConversationId}`}"? Esta ação não apaga as execuções do lote.`);
    if (!confirmed) return;
    setDeletingSavedConversation(true);
    try {
      await client.delete(`/codex/conversations/${selectedSavedConversationId}`);
      const latest = await loadSavedConversations();
      setSelectedSavedConversationId('');
      setSelectedSavedConversationMessages([]);
      registerTelemetry('execution_success', `Conversa salva apagada. Restam ${latest.length} conversa(s) salva(s).`);
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao apagar conversa salva: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setDeletingSavedConversation(false);
    }
  }, [deletingSavedConversation, loadSavedConversations, registerTelemetry, savedConversations, selectedSavedConversationId]);

  const handleRun = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (promptComposerDisabled) {
      setError(promptComposerDisabledReason);
      return;
    }
    if (!isExecutable) {
      setError('Conta ChatGPT não executável pelo Codex App Server. Reconecte para executar.');
      return;
    }
    const userPrompt = prompt.trim();
    if (!userPrompt) {
      setError('Digite a solicitação antes de enviar.');
      return;
    }
    setActionLoading(true);
    try {
      const userMessage: ChatMessage = { id: `${Date.now()}-user`, role: 'user', content: userPrompt, createdAt: new Date().toISOString() };
      const requestPrompt = buildConversationPrompt(userPrompt);
      setConversation((current) => [...current, userMessage]);
      const response = await client.post('/codex/requests', {
        prompt: requestPrompt,
        environment: selectedEnvironment,
        model,
        profile: config.profile,
        imageAttachments: fileAttachments.map(({ name, mimeType, size, dataUrl }) => ({ name, mimeType, size, dataUrl }))
      });
      const created = parseCodexRequest(response.data);
      if (created) {
        const createdContent = isTerminalStatus(created.status) ? extractAssistantContent(created) : `Aguardando resposta do modelo... (${formatStatus(created.status)})`;
        setPrResult(null);
        setConversation((current) => [...current, {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          content: createdContent,
          requestId: created.id,
          environment: created.environment,
          status: created.status,
          createdAt: resolveAssistantMessageTimestamp(created)
        }]);
      }
      setPrompt('');
      setFileAttachments([]);
      setSelectedPromptHintIds([]);
      await loadRequests();
      registerTelemetry('execution_success', `Execução enviada com profile ${config.profile}.`);
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao executar requisição: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [buildConversationPrompt, config.profile, extractAssistantContent, fileAttachments, isExecutable, loadRequests, model, prompt, promptComposerDisabled, promptComposerDisabledReason, registerTelemetry, selectedEnvironment]);


  useEffect(() => {
    const pendingRequestIds = conversation
      .filter((message) => message.role === 'assistant' && message.requestId && message.status && !isTerminalStatus(message.status))
      .map((message) => message.requestId as number);
    if (pendingRequestIds.length === 0) return undefined;

    const refreshPendingRequests = () => {
      if (conversationPollInFlight.current) {
        return;
      }
      conversationPollInFlight.current = true;
      Promise.all(pendingRequestIds.map((requestId) => client.get(`/codex/requests/${requestId}`)))
        .then((responses) => {
          responses.forEach((response) => {
            const parsed = parseCodexRequest(response.data);
            if (parsed) {
              updateAssistantFromRequest(parsed);
              setRequests((current) => mergeCodexRequest(current, parsed));
            }
          });
        })
        .catch((err: Error) => registerTelemetry('poll_error', `Falha ao atualizar conversa: ${err.message}`))
        .finally(() => {
          conversationPollInFlight.current = false;
        });
    };
    refreshPendingRequests();
    const intervalId = window.setInterval(refreshPendingRequests, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [conversation, registerTelemetry, updateAssistantFromRequest]);

  const handleCreatePr = useCallback(async () => {
    setPrLoading(true);
    try {
      if (sandboxOnly) {
        setError('Este perfil executa sem Git/repositório e não gera Pull Request.');
        registerTelemetry('pr_blocked', 'Pedido de PR bloqueado no perfil ChatGPT Codex Sandbox.');
        return;
      }
      const latestRequests = await loadRequests();
      const currentEnvironmentProfileRequests = latestRequests
        .filter((item) => item.environment === selectedEnvironment && item.profile === config.profile);
      const currentBatchKey = findOpenBatchKey(latestRequests, selectedEnvironment, config.profile);
      const currentBatchRequests = currentBatchKey
        ? getOpenBatchRequests(latestRequests, selectedEnvironment, config.profile, currentBatchKey)
        : currentEnvironmentProfileRequests.filter((item) => !isClosedBatchRequest(item));
      const existingPrUrl = currentBatchRequests.find((item) => item.pullRequestUrl)?.pullRequestUrl;

      if (existingPrUrl) {
        setPrResult({ url: existingPrUrl, title: 'Abrir PR do lote' });
        setConversation((current) => [...current, {
          id: `${Date.now()}-pr-requested`,
          role: 'system',
          content: buildPrRequestMarkerContent(existingPrUrl, 'Abrir PR do lote'),
          createdAt: new Date().toISOString()
        }]);
        setPrompt(buildPostPrContinuationPrompt(existingPrUrl, selectedEnvironment));
        setError(null);
        return;
      }

      const hasQueuedOrRunningRequest = currentBatchRequests.some((item) => item.status === 'PENDING' || item.status === 'RUNNING')
        || conversation.some((message) => message.role === 'assistant' && message.status && !isTerminalStatus(message.status));

      if (hasQueuedOrRunningRequest) {
        setError('Aguarde as solicitações pendentes/em execução terminarem antes de pedir o PR do lote.');
        registerTelemetry('pr_blocked', 'Pedido de PR bloqueado porque ainda há solicitação pendente ou em execução.');
        return;
      }

      const lastCompleted = [...conversation].reverse().find((message) => message.role === 'assistant' && message.requestId && message.status === 'COMPLETED');
      const completedRequestId = lastCompleted?.requestId
        ?? [...currentBatchRequests].reverse().find((item) => item.status === 'COMPLETED')?.id;

      if (!completedRequestId) {
        setError('Ainda não há resposta concluída para criar PR.');
        return;
      }
      const response = await client.post(
        `/codex/requests/${completedRequestId}/create-pr`,
        {},
        {
          headers: {
            'X-Role': 'owner',
            'X-User': 'codex-ui'
          }
        }
      );
      const nextPrResult = { url: response.data?.url, title: response.data?.title };
      setPrResult(nextPrResult);
      setConversation((current) => [...current, {
        id: `${Date.now()}-pr-requested`,
        role: 'system',
        content: buildPrRequestMarkerContent(nextPrResult.url, nextPrResult.title),
        createdAt: new Date().toISOString()
      }]);
      setPrompt(buildPostPrContinuationPrompt(nextPrResult.url, selectedEnvironment));
      await loadRequests();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPrLoading(false);
    }
  }, [config.profile, conversation, loadRequests, registerTelemetry, sandboxOnly, selectedEnvironment]);

  const findUserMessageIndexForRequest = useCallback((requestId: number) => {
    const assistantIndex = conversation.findIndex((message) => message.role === 'assistant' && message.requestId === requestId);
    if (assistantIndex <= 0) return -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (conversation[index].role === 'user') return index;
    }
    return -1;
  }, [conversation]);

  const handleStartEditPendingRequest = useCallback((requestId: number) => {
    const userIndex = findUserMessageIndexForRequest(requestId);
    if (userIndex < 0) {
      setError('Não foi possível localizar a mensagem do usuário para editar esta solicitação.');
      return;
    }
    setEditingRequestId(requestId);
    setEditingDraft(conversation[userIndex].content);
    setError(null);
  }, [conversation, findUserMessageIndexForRequest]);

  const handleCancelEditPendingRequest = useCallback(() => {
    setEditingRequestId(null);
    setEditingDraft('');
  }, []);

  const handleSaveEditPendingRequest = useCallback(async (requestId: number) => {
    if (savingEditRequestId) return;
    const nextMessage = editingDraft.trim();
    if (!nextMessage) {
      setError('Informe o novo texto da solicitação antes de salvar.');
      return;
    }
    const userIndex = findUserMessageIndexForRequest(requestId);
    if (userIndex < 0) {
      setError('Não foi possível localizar a mensagem do usuário para editar esta solicitação.');
      return;
    }
    const userMessageId = conversation[userIndex].id;
    const requestPrompt = buildConversationPromptFromHistory(nextMessage, conversation.slice(0, userIndex));
    setSavingEditRequestId(requestId);
    try {
      const response = await client.patch(`/codex/requests/${requestId}`, { prompt: requestPrompt });
      const updated = parseCodexRequest(response.data);
      setConversation((current) => current.map((message) => {
        if (message.id === userMessageId && message.role === 'user') {
          return { ...message, content: nextMessage };
        }
        if (updated && message.role === 'assistant' && message.requestId === requestId) {
          return {
            ...message,
            environment: updated.environment,
            status: updated.status,
            content: isTerminalStatus(updated.status) ? extractAssistantContent(updated) : `Aguardando resposta do modelo... (${formatStatus(updated.status)})`,
            createdAt: resolveAssistantMessageTimestamp(updated, message.createdAt)
          };
        }
        return message;
      }));
      setEditingRequestId(null);
      setEditingDraft('');
      await loadRequests();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEditRequestId(null);
    }
  }, [buildConversationPromptFromHistory, conversation, editingDraft, extractAssistantContent, findUserMessageIndexForRequest, loadRequests, savingEditRequestId]);


  const handleCopyConversationMessage = useCallback(async (message: ChatMessage) => {
    try {
      await copyTextToClipboard(message.content);

      setCopiedMessageId(message.id);
      setError(null);
      if (copiedMessageTimeoutRef.current) {
        window.clearTimeout(copiedMessageTimeoutRef.current);
      }
      copiedMessageTimeoutRef.current = window.setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      setError('Não foi possível copiar a mensagem. Em HTTP simples, use um navegador que permita cópia por interação do usuário.');
    }
  }, []);

  const isOrientationRequested = useCallback((orientation: string) => requestedOrientations.has(orientation), [requestedOrientations]);

  const handleRequestOrientation = useCallback((orientation: string) => {
    setPrompt(`Execute sua orientação : \n${orientation}`);
    setRequestedOrientations((current) => {
      const next = new Set(current);
      next.add(orientation);
      return next;
    });
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }, []);

  const handlePreparePostPrContinuation = useCallback((prUrl?: string) => {
    setPrompt(buildPostPrContinuationPrompt(prUrl, selectedEnvironment));
    setError(null);
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }, [selectedEnvironment]);

  const handleStartNewSandboxDialog = useCallback(() => {
    if (!sandboxOnly) return;
    const hasCurrentDialog = conversation.length > 0 || prompt.trim().length > 0 || fileAttachments.length > 0 || Boolean(selectedSavedConversationId);
    if (!hasCurrentDialog) return;

    const confirmed = conversation.length === 0
      || window.confirm('Limpar o diálogo atual e começar uma nova conversa? As execuções já registradas continuarão no histórico.');
    if (!confirmed) return;

    setConversation([]);
    setPrompt('');
    setFileAttachments([]);
    setSelectedSavedConversationId('');
    setSelectedSavedConversationMessages([]);
    setEditingRequestId(null);
    setEditingDraft('');
    setPrResult(null);
    setError(null);
    setCopiedMessageId(null);
    setRequestedOrientations(new Set());
    registerTelemetry('execution_success', 'Diálogo sandbox limpo para iniciar uma nova conversa.');
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }, [conversation.length, fileAttachments.length, prompt, registerTelemetry, sandboxOnly, selectedSavedConversationId]);

  const handleDeletePendingRequest = useCallback(async (requestId: number) => {
    if (deletingRequestId) return;
    setDeletingRequestId(requestId);
    try {
      await client.delete(`/codex/requests/${requestId}`);
      setConversation((current) => current.map((message) => {
        if (message.role !== 'assistant' || message.requestId !== requestId) return message;
        return {
          ...message,
          content: `Solicitação #${requestId} apagada antes do envio ao modelo. Nenhuma resposta será gerada para esta mensagem.`,
          requestId: undefined,
          status: undefined,
          createdAt: new Date().toISOString()
        };
      }));
      if (editingRequestId === requestId) {
        setEditingRequestId(null);
        setEditingDraft('');
      }
      await loadRequests();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingRequestId(null);
    }
  }, [deletingRequestId, editingRequestId, loadRequests]);

  const handleCancelRequest = useCallback(async (requestId: number) => {
    if (cancellingRequestId) return;
    const confirmed = window.confirm(`Cancelar a solicitação #${requestId}? Use esta opção quando ela foi enviada por engano ou não precisa mais executar.`);
    if (!confirmed) return;

    setCancellingRequestId(requestId);
    try {
      const response = await client.post(`/codex/requests/${requestId}/cancel`);
      const updated = parseCodexRequest(response.data);
      if (updated) {
        updateAssistantFromRequest(updated);
        setRequests((current) => mergeCodexRequest(current, updated));
      }
      if (editingRequestId === requestId) {
        setEditingRequestId(null);
        setEditingDraft('');
      }
      await loadRequests();
      registerTelemetry('execution_success', `Solicitação #${requestId} cancelada pelo usuário.`);
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao cancelar solicitação #${requestId}: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setCancellingRequestId(null);
    }
  }, [cancellingRequestId, editingRequestId, loadRequests, registerTelemetry, updateAssistantFromRequest]);

  const handleRating = useCallback(async (requestId: number, rating: number) => {
    if (ratingRequestId) return;

    setRatingRequestId(requestId);
    try {
      const response = await client.post(`/codex/requests/${requestId}/rating`, { rating });
      const updated = parseCodexRequest(response.data);
      if (updated) {
        setRequests((current) => mergeCodexRequest(current, updated));
        updateAssistantFromRequest(updated);
      } else {
        await loadRequests();
      }
      registerTelemetry('execution_success', `Avaliação registrada para solicitação #${requestId}.`);
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao avaliar solicitação #${requestId}: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setRatingRequestId(null);
    }
  }, [loadRequests, ratingRequestId, registerTelemetry, updateAssistantFromRequest]);

  const handleDiscardBatchRequests = useCallback(async () => {
    if (bulkDiscardLoading) return;

    setBulkDiscardLoading(true);
    try {
      const latestRequests = await loadRequests();
      const currentBatchKey = findOpenBatchKey(latestRequests, selectedEnvironment, config.profile);
      const batchRequests = getOpenBatchRequests(latestRequests, selectedEnvironment, config.profile, currentBatchKey);
      const requestsToDiscard = batchRequests.filter((item) => item.status === 'PENDING' || item.status === 'RUNNING');

      if (currentBatchKey && batchRequests.length > 0) {
        const confirmed = window.confirm(`Zerar este lote com ${batchRequests.length} solicitação(ões)? Solicitações pendentes/em execução serão descartadas e solicitações concluídas sairão do lote atual.`);
        if (!confirmed) return;

        const response = await client.post<DiscardBatchResult>('/codex/requests/batch/discard', {
          environment: selectedEnvironment,
          profile: config.profile,
          workBatchKey: currentBatchKey
        });
        const result = response.data;
        const branchMessage = result.branchDeleted === false && result.branchDeletionWarning
          ? ` ${result.branchDeletionWarning}`
          : '';
        registerTelemetry('execution_success', `${result.total ?? batchRequests.length} solicitação(ões) removida(s) do lote atual; ${result.cancelled ?? requestsToDiscard.length} cancelada(s), ${result.deleted ?? 0} apagada(s), ${result.detached ?? 0} desanexada(s).${branchMessage}`);
      }

      setConversation([]);
      setEditingRequestId(null);
      setEditingDraft('');
      setPrResult(null);
      await loadRequests();
      setError(null);
    } catch (err) {
      registerTelemetry('execution_failed', `Falha ao descartar solicitações do lote: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setBulkDiscardLoading(false);
    }
  }, [bulkDiscardLoading, config.profile, loadRequests, registerTelemetry, selectedEnvironment]);

  const activeBatchKey = findOpenBatchKey(requests, selectedEnvironment, config.profile);
  const activeBatchRequests = getOpenBatchRequests(requests, selectedEnvironment, config.profile, activeBatchKey);
  const activeBatchCompleted = activeBatchRequests.filter((item) => item.status === 'COMPLETED').length;
  const activeBatchCompletedCodeChanges = activeBatchRequests
    .filter((item) => item.status === 'COMPLETED' && marketingResponseIndicatesCodeChange(item.responseText))
    .length;
  const activeBatchPrRelevantCompleted = config.profile === 'CHATGPT_CODEX_MKT'
    ? activeBatchCompletedCodeChanges
    : activeBatchCompleted;
  const activeBatchRunning = activeBatchRequests.filter((item) => item.status === 'RUNNING').length;
  const activeBatchPending = activeBatchRequests.filter((item) => item.status === 'PENDING').length;
  const activeBatchDiscardableRequests = (activeBatchKey ? activeBatchRequests : [])
    .filter((item) => item.profile === config.profile);
  const activeBatchDiscardable = activeBatchDiscardableRequests.length;
  const activeBatchPrUrl = activeBatchRequests.find((item) => item.pullRequestUrl)?.pullRequestUrl;
  const selectedSavedConversation = selectedSavedConversationId
    ? savedConversations.find((item) => item.id === selectedSavedConversationId)
    : undefined;
  const hasCompletedConversationRequest = conversation.some((message) => message.role === 'assistant' && message.status === 'COMPLETED');
  const hasQueuedConversationRequest = conversation.some((message) => message.role === 'assistant' && message.status && !isTerminalStatus(message.status));
  const handleScrollToFirstUnreadModelResponse = useCallback(() => {
    if (!firstUnreadModelResponseId) {
      return;
    }
    const element = conversationMessageRefs.current.get(firstUnreadModelResponseId);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.focus({ preventScroll: true });
  }, [firstUnreadModelResponseId]);
  const canStartNewSandboxDialog = sandboxOnly && (conversation.length > 0 || prompt.trim().length > 0 || fileAttachments.length > 0 || Boolean(selectedSavedConversationId));
  const hasQueuedOrRunningBatchRequest = activeBatchRequests.some((item) => item.status === 'PENDING' || item.status === 'RUNNING');
  const hasAccumulatedCodeAwaitingPr = Boolean(activeBatchKey && activeBatchPrRelevantCompleted > 0 && !activeBatchPrUrl);
  const accumulatedCodeWarning = hasAccumulatedCodeAwaitingPr
    ? config.profile === 'CHATGPT_CODEX_MKT'
      ? `${activeBatchPrRelevantCompleted} solicitação(ões) com alteração de código neste lote ainda precisam passar por PR antes do merge.`
      : `${activeBatchPrRelevantCompleted} solicitação(ões) concluída(s) neste lote ainda precisam passar por PR antes do merge.`
    : null;
  const prBlockedReason = hasQueuedConversationRequest || hasQueuedOrRunningBatchRequest
    ? 'Aguarde todas as solicitações do lote terminarem antes de pedir PR.'
    : !hasCompletedConversationRequest && activeBatchCompleted === 0 && !activeBatchPrUrl
      ? 'Ainda não há solicitação concluída neste lote.'
      : accumulatedCodeWarning ?? 'O backend vai validar o diff funcional acumulado antes de criar o PR.';
  const canRequestPr = Boolean(
    !sandboxOnly
    && selectedEnvironment
    && model
    && !hasQueuedConversationRequest
    && !hasQueuedOrRunningBatchRequest
    && (hasCompletedConversationRequest || activeBatchCompleted > 0 || activeBatchPrUrl)
  );
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-2xl font-semibold">{config.title}</h2>
        <div className={`fixed right-4 top-4 z-40 w-[min(236px,calc(100vw-2rem))] rounded-md border bg-white/95 px-3 py-2 text-right shadow-lg backdrop-blur dark:bg-slate-900/90 ${interactionIsStale ? 'border-amber-500 ring-2 ring-amber-300/70 dark:border-amber-500 dark:ring-amber-700/60' : 'border-slate-200 dark:border-slate-800'}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dia operacional</p>
          <p className="text-sm font-medium leading-5 text-slate-700 dark:text-slate-200">
            {formatOperationalDayDate(dailyMetrics?.day?.startsAt)}
          </p>
          <p className="text-base font-semibold leading-5 text-emerald-700 dark:text-emerald-300">
            {formatDuration(dailyMetrics?.day?.durationMs)}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-center">
            <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-700 dark:bg-slate-800/80">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Solicitações</p>
              <p className="text-xs font-semibold leading-4 text-slate-800 dark:text-slate-100">
                {formatMetricNumber(dailyMetrics?.day?.requestCount)}
              </p>
            </div>
            <div className={`rounded border px-1.5 py-1 ${interactionIsStale ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-500 dark:bg-amber-950/50' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80'}`}>
              <p className={`text-[9px] font-semibold uppercase tracking-wide ${interactionIsStale ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                Interações
                {interactionIsStale ? <span className="ml-1 inline-flex h-3 w-3 animate-pulse items-center justify-center rounded-full bg-amber-500 text-[9px] text-white" aria-hidden="true">!</span> : null}
              </p>
              <p className="text-xs font-semibold leading-4 text-slate-800 dark:text-slate-100">
                {formatMetricNumber(dailyMetrics?.day?.interactionCount)}
              </p>
              {interactionIsStale ? <span role="status" className="sr-only">Alerta: interações sem alteração há 5 minutos.</span> : null}
            </div>
          </div>
          {config.profile === 'CHATGPT_CODEX_MKT' ? (
            <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Placar de vendas</p>
                <p className="text-[9px] text-slate-500">{formatMetricNumber(dailyMetrics?.salesImpactDay?.total)} avaliadas</p>
              </div>
              <div className="mt-1 grid grid-cols-5 gap-1" aria-label="Placar diário por impacto em vendas">
                {([
                  ['muito_baixo', 'muitoBaixo', 'Muito baixo'],
                  ['baixo', 'baixo', 'Baixo'],
                  ['medio', 'medio', 'Médio'],
                  ['alto', 'alto', 'Alto'],
                  ['muito_alto', 'muitoAlto', 'Muito alto']
                ] as const).map(([level, key, label]) => (
                  <div key={level} className="flex flex-col items-center rounded border border-slate-200 bg-slate-50 px-1 py-1 dark:border-slate-700 dark:bg-slate-800/80" title={`${label}: ${formatMetricNumber(dailyMetrics?.salesImpactDay?.[key])}`}>
                    <SalesImpactIcon level={level} />
                    <span className="mt-0.5 text-[10px] font-semibold leading-3 text-slate-800 dark:text-slate-100">{formatMetricNumber(dailyMetrics?.salesImpactDay?.[key])}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <p className="mt-1 text-[10px] leading-3 text-slate-500">Corte às 03:00 · São Paulo</p>
        </div>
      </div>
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

      <div className="rounded-xl border border-slate-200 bg-white/70 p-5 text-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Lote atual</h3>
            <p className="mt-1 text-slate-500">As próximas solicitações deste ambiente entram na mesma branch acumulada; o PR só é criado se o backend encontrar alteração funcional além do diário obrigatório.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeBatchPrUrl ? <a href={activeBatchPrUrl} target="_blank" rel="noreferrer" className="rounded-md border border-emerald-600 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50">Abrir PR do lote</a> : null}
            <button type="button" onClick={handleDiscardBatchRequests} disabled={bulkDiscardLoading || (!activeBatchDiscardable && conversation.length === 0)} className="rounded-md border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30">{bulkDiscardLoading ? 'Descartando...' : 'Zerar e descartar lote'}</button>
          </div>
        </div>
        {activeBatchKey ? <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <p className="min-w-0 rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-200">{activeBatchKey}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-800">{activeBatchCompleted} concluída(s)</span>
            <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800">{activeBatchRunning} em execução</span>
            <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">{activeBatchPending} pendente(s)</span>
          </div>
        </div> : <p className="mt-3 text-slate-500">Nenhum lote aberto para o ambiente selecionado.</p>}
        {accumulatedCodeWarning ? (
          <p className="mt-3 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200">
            Código acumulado para merge: {accumulatedCodeWarning}
          </p>
        ) : null}
      </div>

      <form onSubmit={handleRun} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-lg font-semibold">{config.formTitle}</h3>
        <p className="text-sm text-slate-500">{config.description}</p>
        {sandboxOnly ? <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleStartNewSandboxDialog}
            disabled={!canStartNewSandboxDialog}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Novo diálogo
          </button>
        </div> : null}
        <div className="rounded-lg border border-slate-200 bg-white/80 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Conversa salva para contexto</span>
              <select
                value={selectedSavedConversationId}
                onChange={(event) => void handleSelectSavedConversation(event.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Sem conversa salva selecionada</option>
                {savedConversations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.messageCount} msg · {formatDateTime(item.updatedAt)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                onClick={handleSaveConversation}
                disabled={savingConversation || conversation.length === 0}
                className="w-full rounded-md border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50 lg:w-auto"
              >
                {savingConversation ? 'Salvando...' : 'Salvar conversa'}
              </button>
              <button
                type="button"
                onClick={handleDeleteSavedConversation}
                disabled={deletingSavedConversation || !selectedSavedConversationId}
                className="w-full rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50 lg:w-auto dark:border-rose-900 dark:text-rose-300"
              >
                {deletingSavedConversation ? 'Apagando...' : 'Apagar salva'}
              </button>
            </div>
          </div>
          {selectedSavedConversation ? <p className="mt-2 text-xs text-slate-500">
            O próximo envio incluirá essa conversa salva no prompt do modelo; o diálogo antigo não precisa ser renderizado na tela.
          </p> : <p className="mt-2 text-xs text-slate-500">Salve apenas os diálogos que precisar retomar depois.</p>}
        </div>
        {conversation.length > 0 ? <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <p className="rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60">
            Exibimos somente as últimas {MAX_VISIBLE_CONVERSATION_MESSAGES} mensagens para evitar peso no navegador; ao salvar, a conversa completa da sessão é preservada{hiddenConversationMessages > 0 ? ` (${hiddenConversationMessages} mensagem(ns) antiga(s) fora do recorte).` : '.'}
          </p>
          {dismissedRequestCount > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-emerald-900 dark:bg-slate-900/70 dark:text-slate-300">
            <span>
              {dismissedRequestCount.toLocaleString('pt-BR')} solicitação(ões) lida(s) retirada(s) da tela
              {dismissedConversationMessageCount > 0 ? ` (${dismissedConversationMessageCount.toLocaleString('pt-BR')} mensagem(ns)).` : '.'}
            </span>
            <button
              type="button"
              onClick={handleRestoreHiddenRequests}
              className="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline dark:text-emerald-300 dark:hover:text-emerald-200"
            >
              Mostrar novamente
            </button>
          </div> : null}
          {visibleConversation.map((message, messageIndex) => {
            const nextMessage = visibleConversation[messageIndex + 1];
            const isEditingUserMessage = message.role === 'user' && nextMessage?.role === 'assistant' && nextMessage.requestId === editingRequestId;
            const messageEnvironment = message.environment ?? (message.requestId ? requestEnvironmentById.get(message.requestId) : undefined);
            return <article
              key={message.id}
              ref={(element) => {
                if (element) {
                  conversationMessageRefs.current.set(message.id, element);
                } else {
                  conversationMessageRefs.current.delete(message.id);
                }
              }}
              tabIndex={message.id === firstUnreadModelResponseId ? -1 : undefined}
              className={`rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              message.role === 'user'
                ? 'ml-auto max-w-3xl bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100'
                : message.role === 'system'
                  ? 'mx-auto max-w-2xl border border-dashed border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
                  : 'mr-auto max-w-3xl bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100'
            }`}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span className="min-w-0">
                  {message.role === 'user' ? 'Usuário' : message.role === 'system' ? 'Sistema' : 'Modelo'} · {formatDateTime(message.createdAt)}
                  {message.requestId ? ` · Ambiente: ${formatRequestEnvironment(messageEnvironment)}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyConversationMessage(message)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white/70 text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-emerald-500 dark:hover:text-emerald-300"
                    title={`Copiar mensagem do ${message.role === 'user' ? 'usuário' : message.role === 'system' ? 'sistema' : 'modelo'}`}
                    aria-label={`Copiar mensagem do ${message.role === 'user' ? 'usuário' : message.role === 'system' ? 'sistema' : 'modelo'}`}
                  >
                    {copiedMessageId === message.id ? '✓' : '⧉'}
                  </button>
                  {message.requestId && message.status === 'PENDING' ? <button type="button" onClick={() => handleStartEditPendingRequest(message.requestId!)} disabled={savingEditRequestId === message.requestId} className="normal-case text-sky-700 hover:underline disabled:opacity-50">Editar solicitação</button> : null}
                  {message.requestId && message.status === 'PENDING' ? <button type="button" onClick={() => handleDeletePendingRequest(message.requestId!)} disabled={deletingRequestId === message.requestId} className="normal-case text-rose-600 hover:underline disabled:opacity-50">Apagar antes do envio</button> : null}
                  {message.requestId && isCancellableRequestStatus(message.status) ? <button type="button" onClick={() => handleCancelRequest(message.requestId!)} disabled={cancellingRequestId === message.requestId} className="normal-case text-rose-600 hover:underline disabled:opacity-50">{cancellingRequestId === message.requestId ? 'Cancelando...' : 'Cancelar solicitação'}</button> : null}
                  {message.requestId ? <Link to={`/codex/requests/${message.requestId}`} className="normal-case text-emerald-700 hover:underline">Execução #{message.requestId}</Link> : null}
                </span>
              </div>
              {isEditingUserMessage ? <div className="space-y-2">
                <textarea value={editingDraft} onChange={(event) => setEditingDraft(event.target.value)} rows={4} className="w-full rounded-md border border-emerald-200 bg-white/90 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-emerald-800 dark:bg-slate-900 dark:text-slate-100" />
                <div className="flex flex-wrap justify-end gap-2 text-xs">
                  <button type="button" onClick={handleCancelEditPendingRequest} disabled={savingEditRequestId === editingRequestId} className="rounded-md border border-slate-300 px-3 py-1 font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Cancelar</button>
                  <button type="button" onClick={() => editingRequestId ? handleSaveEditPendingRequest(editingRequestId) : undefined} disabled={!editingRequestId || savingEditRequestId === editingRequestId} className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">Salvar edição</button>
                </div>
              </div> : <AssistantMessageBody
                content={message.content}
                structuredResponse={message.role === 'assistant'}
                commentRead={readCommentIds.has(message.id)}
                onCommentReadChange={config.profile === 'CHATGPT_CODEX_MKT' && message.role === 'assistant' ? (read) => handleCommentReadChange(message.id, read) : undefined}
                onDismissRequest={config.profile === 'CHATGPT_CODEX_MKT' && message.role === 'assistant' && message.requestId && readCommentIds.has(message.id) ? () => handleDismissConversationRequest(message.requestId!) : undefined}
                isOrientationRequested={isOrientationRequested}
                onRequestOrientation={handleRequestOrientation}
              />}
            </article>;
          })}
        </div> : <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700">A conversa aparecerá aqui após a primeira mensagem.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {sandboxOnly ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
              Ambiente temporário: sandbox
            </div>
          ) : (
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
              {environments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          )}
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border px-3 py-2 text-sm">
            {models.map((item) => <option key={item.id} value={item.modelName}>{item.displayName ?? item.modelName}</option>)}
          </select>
        </div>
        {showProductSelector ? <select value={selectedProductSlug} onChange={(e) => setSelectedProductSlug(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" disabled={productsLoading}>
          <option value="">{productsLoading ? 'Carregando produtos...' : 'Sem produto selecionado'}</option>
          {products.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
        </select> : null}
        {config.profile === 'CHATGPT_CODEX_MKT' && conversation.length > 0 ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleScrollToFirstUnreadModelResponse}
              disabled={!firstUnreadModelResponseId}
              className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
              title={firstUnreadModelResponseId ? 'Ir para a primeira resposta do modelo ainda não lida' : 'Não há resposta do modelo pendente de leitura'}
              aria-label="Ir para primeira resposta não lida"
            >
              <span aria-hidden="true">↑</span>
              <span>Primeira resposta não lida</span>
            </button>
          </div>
        ) : null}
        {promptComposerDisabled ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {promptComposerDisabledReason}
        </p> : null}
        <div className="relative">
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={handlePromptPaste}
            rows={5}
            placeholder={promptComposerDisabled ? promptComposerDisabledReason : config.placeholder}
            className="w-full rounded-md border px-3 py-2 pr-12 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
            required
            disabled={promptComposerDisabled}
          />
          <button
            type="button"
            onClick={handleResetPrompt}
            disabled={promptComposerDisabled || prompt.length === 0}
            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
            aria-label="Limpar texto da solicitação"
            title="Limpar texto da solicitação"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/50">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-700 dark:text-slate-200">Itens opcionais para usar na solicitação</p>
            <Link
              to="/prompt-hints"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-500"
            >
              Gerenciar itens
            </Link>
          </div>
          {loadingPromptHints ? <p className="text-xs text-slate-500 dark:text-slate-400">Carregando itens disponíveis...</p> : null}
          {promptHintsError ? <p className="text-xs text-red-500">{promptHintsError}</p> : null}
          {!loadingPromptHints && !promptHintsError && promptHints.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nenhum item configurado para este ambiente.
            </p>
          ) : null}
          {(generalPromptHints.length > 0 || scopedPromptHints.length > 0) ? (
            <div className="space-y-4">
              {generalPromptHints.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Itens gerais
                  </p>
                  <div className="space-y-2">
                    {generalPromptHints.map((hint) => (
                      <label key={hint.id} className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedPromptHintIds.includes(hint.id)}
                          onChange={(event) => handlePromptHintToggle(hint, event.target.checked)}
                          disabled={promptComposerDisabled}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span>{hint.label}</span>
                          <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            {promptHintTypeLabel(hint.type)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {scopedPromptHints.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Itens para {selectedEnvironment || 'o ambiente selecionado'}
                  </p>
                  <div className="space-y-2">
                    {scopedPromptHints.map((hint) => (
                      <label key={hint.id} className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedPromptHintIds.includes(hint.id)}
                          onChange={(event) => handlePromptHintToggle(hint, event.target.checked)}
                          disabled={promptComposerDisabled}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span>{hint.label}</span>
                          <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            {promptHintTypeLabel(hint.type)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Anexar arquivos
            <input type="file" multiple onChange={handleFileInputChange} className="sr-only" disabled={promptComposerDisabled} />
          </label>
          <p className="mt-2 text-xs text-slate-500">Cole arquivos com Ctrl+V no campo da tarefa ou selecione qualquer tipo de arquivo. Até {MAX_FILE_ATTACHMENTS} arquivos de 5 MB.</p>
          {fileAttachments.length > 0 ? <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fileAttachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800">
                {isImageAttachment(attachment)
                  ? <img src={attachment.dataUrl} alt={attachment.name} className="h-14 w-20 rounded object-cover" />
                  : <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-slate-100 px-2 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">{attachment.name.split('.').pop()?.slice(0, 6) || 'file'}</div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{attachment.name}</p>
                  <p className="text-[11px] text-slate-500">{Math.ceil(attachment.size / 1024)} KB - {attachment.mimeType}</p>
                </div>
                <button type="button" onClick={() => removeFileAttachment(attachment.id)} className="text-xs text-rose-600 hover:underline">Remover</button>
              </li>
            ))}
          </ul> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={actionLoading || promptComposerDisabled || !isExecutable || !selectedEnvironment || !model} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Enviar mensagem</button>
          {sandboxOnly ? <button type="button" onClick={handleStartNewSandboxDialog} disabled={!canStartNewSandboxDialog} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Novo diálogo</button> : null}
          {!sandboxOnly ? (
            <button
              type="button"
              onClick={handleCreatePr}
              disabled={prLoading || !canRequestPr}
              title={prBlockedReason}
              className={`inline-flex flex-wrap items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                hasAccumulatedCodeAwaitingPr
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200 dark:hover:bg-indigo-950/50'
                  : 'border-emerald-600 text-emerald-700'
              }`}
            >
              <span>{prLoading ? 'Pedindo PR...' : 'Pedir PR'}</span>
              {hasAccumulatedCodeAwaitingPr ? <span className="rounded-full bg-indigo-200 px-2 py-0.5 text-[11px] font-semibold text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100">Código pendente</span> : null}
            </button>
          ) : null}
          {!sandboxOnly ? <button type="button" onClick={handleDiscardBatchRequests} disabled={bulkDiscardLoading || (!activeBatchDiscardable && conversation.length === 0)} className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">{bulkDiscardLoading ? 'Descartando...' : 'Zerar e descartar solicitações'}</button> : null}
        </div>
        {!sandboxOnly ? <p className="text-xs text-slate-500">{prBlockedReason}</p> : null}
        {prResult ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              PR solicitado: {prResult.url ? <a href={prResult.url} target="_blank" rel="noreferrer" className="font-medium underline">{prResult.title || prResult.url}</a> : prResult.title || 'criado com sucesso'}
            </p>
            <button
              type="button"
              onClick={() => handlePreparePostPrContinuation(prResult.url)}
              disabled={promptComposerDisabled}
              className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:bg-slate-900 dark:text-emerald-200 dark:hover:bg-emerald-950/50"
            >
              Continuar resolução
            </button>
          </div>
          <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
            Depois da aprovação/deploy, use esta continuação no mesmo diálogo para o modelo validar o resultado e seguir sem perder contexto.
          </p>
        </div> : null}
        {!isExecutable ? <p className="text-sm text-amber-700 dark:text-amber-300">Bloqueado: {account?.blockReason || 'Codex App Server sem conta executável.'}</p> : null}
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-lg font-semibold">{config.historyTitle}</h3>
        <ul className="space-y-2">
          {requests.map((item) => (
            <li key={item.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium" title={resolveRequestHistoryHeading(item)}>
                  {resolveRequestHistoryHeading(item)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${codexStatusStyles[item.status]}`}>{formatStatus(item.status)}</span>
              </div>
              {item.model ? <p className="mt-1 truncate text-xs text-slate-500">Modelo: {item.model}</p> : null}
              <p className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Ambiente:</span> {formatRequestEnvironment(item.environment)}
                <span className="mx-2 text-slate-300 dark:text-slate-700">|</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Perfil:</span> {formatProfile(item.profile)}
              </p>
              {item.workBranch ? <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{item.workBranch}</p> : null}
              {(item.status === 'COMPLETED' || item.interactionCount !== undefined || item.documentAccessCount !== undefined || item.totalTokens !== undefined || item.cost !== undefined || item.durationMs !== undefined) ? <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                {item.status === 'COMPLETED' || item.durationMs !== undefined ? <span>Tempo gasto: <strong className="font-medium text-slate-700 dark:text-slate-300">{formatDuration(item.durationMs)}</strong></span> : null}
                {item.cloneDurationMs !== undefined ? <span>Clone do repositório: <strong className="font-medium text-slate-700 dark:text-slate-300">{formatDuration(item.cloneDurationMs)}</strong></span> : null}
                {item.interactionCount !== undefined ? <span>Interações: <strong className="font-medium text-slate-700 dark:text-slate-300">{formatInteractionCount(item.interactionCount)}</strong></span> : null}
                {item.documentAccessCount !== undefined ? <span>Documentos lidos: <strong className="font-medium text-slate-700 dark:text-slate-300">{formatDocumentAccessCount(item.documentAccessCount)}</strong></span> : null}
                {item.status === 'COMPLETED' || item.totalTokens !== undefined ? <span>Tokens: <strong className="font-medium text-slate-700 dark:text-slate-300">{formatTokens(item.totalTokens)}</strong></span> : null}
                {item.status === 'COMPLETED' || item.cost !== undefined ? <span>Custo estimado: <strong className="font-medium text-slate-700 dark:text-slate-300">{formatCost(item.cost)}</strong></span> : null}
              </div> : null}
              <div className="mt-1 flex flex-wrap gap-3">
                <Link to={`/codex/requests/${item.id}`} className="text-xs text-emerald-700 hover:underline">Abrir detalhes</Link>
                {item.status === 'PENDING' && !item.externalId ? <button type="button" onClick={() => handleDeletePendingRequest(item.id)} disabled={deletingRequestId === item.id} className="text-xs text-rose-600 hover:underline disabled:opacity-50">Apagar antes do envio</button> : null}
                {isCancellableRequestStatus(item.status) ? <button type="button" onClick={() => handleCancelRequest(item.id)} disabled={cancellingRequestId === item.id} className="text-xs text-rose-600 hover:underline disabled:opacity-50">{cancellingRequestId === item.id ? 'Cancelando...' : 'Cancelar solicitação'}</button> : null}
              </div>
              <div className="mt-2 flex items-center gap-1" aria-label={`Avaliação da execução #${item.id}`}>
                {[1, 2, 3, 4, 5].map((value) => {
                  const currentRating = item.rating ?? 0;
                  const filled = value <= currentRating;
                  const isInteractive = item.status === 'COMPLETED';
                  if (!isInteractive) {
                    return <span key={`static-rating-${item.id}-${value}`} className={`text-base ${filled ? 'text-amber-500' : 'text-slate-400'}`}>★</span>;
                  }
                  return <button
                    key={`rating-${item.id}-${value}`}
                    type="button"
                    onClick={() => handleRating(item.id, value)}
                    disabled={ratingRequestId === item.id}
                    className="text-base transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    title={`Avaliar execução #${item.id} com ${value} estrela${value === 1 ? '' : 's'}`}
                    aria-label={`Avaliar execução #${item.id} com ${value} estrela${value === 1 ? '' : 's'}`}
                  >
                    <span className={filled ? 'text-amber-500' : 'text-slate-400'}>★</span>
                  </button>;
                })}
              </div>
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
