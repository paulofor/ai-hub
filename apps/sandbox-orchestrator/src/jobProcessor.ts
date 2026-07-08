import { exec as execCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import mysql, { Pool } from 'mysql2/promise';
import OpenAI from 'openai';
import {
  ResponseFunctionToolCallItem,
  ResponseFunctionToolCallOutputItem,
  ResponseItem,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseReasoningItem,
} from 'openai/resources/responses/responses.js';

import { CodexAppServerClient } from './codexAppServerClient.js';
import { readCodexAccount } from './codexAppServerAuth.js';
import { buildAuthRepoUrl, extractTokenFromRepoUrl, redactUrlCredentials } from './git.js';
import { JobProcessor, SandboxJob, SandboxProfile, SandboxInteraction, SandboxHttpRequestLog, SandboxDatabaseConfig } from './types.js';

function resolveOpenAIOrganization(): string | undefined {
  const organization = process.env.OPENAI_ORGANIZATION ?? process.env.OPENAI_ORG_ID ?? process.env.HUB_ACCOUNT_OAUTH_ORGANIZATION_ID;
  return organization && organization.trim() ? organization.trim() : undefined;
}

function buildOpenAIClient(apiKey: string): OpenAI {
  const organization = resolveOpenAIOrganization();
  return new OpenAI({
    apiKey,
    ...(organization ? { organization } : {}),
  });
}

export const openAIClientConfigForTests = { resolveOpenAIOrganization };

function sanitizeOpenAIExchange(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOpenAIExchange(item));
  }
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = isSensitiveOpenAIExchangeKey(key) ? '[redacted]' : sanitizeOpenAIExchange(entryValue);
    }
    return sanitized;
  }
  if (typeof value === 'string') {
    return value.replace(/(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [redacted]');
  }
  return value;
}

function isSensitiveOpenAIExchangeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes('token')
    || normalized.includes('secret')
    || normalized === 'authorization'
    || normalized === 'api_key'
    || normalized === 'apikey';
}

function logOpenAIExchange(direction: 'outbound' | 'inbound' | 'error', operation: string, payload: unknown): void {
  const serialized = JSON.stringify(sanitizeOpenAIExchange(payload));
  console.log(`OpenAI exchange ${direction} operation=${operation} payload=${serialized}`);
}

const exec = promisify(execCallback);

const ECO_TWO_LOOP_GUARDED_TOOLS = new Set(['run_shell', 'http_get', 'WebSearch', 'db_query']);
const IMAGE_TOOL_ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const INSPECTION_SHELL_EXECUTABLES = new Set([
  'cat',
  'sed',
  'rg',
  'grep',
  'tail',
  'head',
  'less',
  'more',
  'stat',
  'wc',
  'ls',
  'find',
]);

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ImageToolResult {
  type: 'image';
  source: 'read_image' | 'fetch_image';
  path?: string;
  url?: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  note: string;
}

interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
}

interface EcoTwoLoopAttempt {
  signature: string;
  outputHash: string;
  toolName: string;
  timestamp: number;
}

interface EcoTwoLoopState {
  attempts: EcoTwoLoopAttempt[];
  blockedSignature?: string;
  blockedCount: number;
}

interface EcoTwoLoopBlockResult {
  payload: Record<string, unknown>;
  logMessage: string;
}

interface ContextWorkingSetItem {
  key: string;
  title: string;
  content: string;
  source: string;
  createdAt: number;
}

interface LayeredContextState {
  summaryLines: string[];
  workingSet: ContextWorkingSetItem[];
  turnsSinceCompaction: number;
  evidenceCache: Map<string, unknown>;
  recentToolCalls: SimilarityCallSnapshot[];
  cacheStats: {
    hitCount: number;
    missCount: number;
    redundantAvoided: number;
  };
  shellCommandCache: Map<string, ShellCommandCacheEntry>;
  shellMetrics: ShellCommandMetrics;
  firstPatchAtTurn?: number;
  firstPatchLatencyMs?: number;
  turnCounter: number;
}

interface ShellCommandCacheEntry {
  key: string;
  cwd: string;
  command: string;
  result: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  };
  createdAt: number;
  window?: FileWindowRequest;
}

interface FileWindowRequest {
  file: string;
  startLine: number;
  endLine: number;
}

interface ShellCommandMetrics {
  totalCommands: number;
  duplicateCommands: number;
  uniqueBySignature: Map<string, number>;
  alertThreshold: number;
}

interface SimilarityCallSnapshot {
  signature: string;
  similarityKey: string;
  toolName: string;
  timestamp: number;
}

type InvestigationStage = 'REPRODUZIR' | 'LOCALIZAR_CAUSA' | 'APLICAR_CORRECAO' | 'VALIDAR' | 'ENCERRAR';

interface ObjectiveAttemptState {
  attempts: number;
  lastOutputHash?: string;
  blocked: boolean;
  updatedAt: number;
}

interface InvestigationProgressState {
  stage: InvestigationStage;
  completedStages: InvestigationStage[];
  objectiveAttempts: Map<string, ObjectiveAttemptState>;
  blockedObjectives: string[];
  localizarCausaNoEvidenceCycles: number;
  localizarCausaLastEvidenceHash?: string;
  localizarCausaLastEvidenceAt?: number;
}

interface RunnerEnvironmentState {
  repoPath: string;
  validatedCwd: string;
  branch: string;
  permissionProfile: 'read-write-execute';
  essentialTools: string[];
  browserTools: string[];
  supplementalBinPath?: string;
  validatedAt: string;
  repeatedErrorBySignature: Map<string, { errorSignature: string; count: number }>;
}

class JobCancelledError extends Error {
  constructor(message = 'Job cancelado pelo usuário') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

export class SandboxJobProcessor implements JobProcessor {
  private static readonly INVESTIGATION_STAGES: InvestigationStage[] = [
    'REPRODUZIR',
    'LOCALIZAR_CAUSA',
    'APLICAR_CORRECAO',
    'VALIDAR',
    'ENCERRAR',
  ];

  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly fetchImpl?: (input: string | URL, init?: any) => Promise<any>;
  private readonly githubApiBase: string;
  private readonly maxTaskDescriptionChars: number;
  private readonly toolOutputStringLimit: number;
  private readonly toolOutputSerializedLimit: number;
  private readonly httpToolTimeoutMs: number;
  private readonly httpToolMaxResponseChars: number;
  private readonly economyModel?: string;
  private readonly economyMaxTaskDescriptionChars: number;
  private readonly economyToolOutputStringLimit: number;
  private readonly economyToolOutputSerializedLimit: number;
  private readonly economyHttpToolMaxResponseChars: number;
  private readonly smartEconomyMaxTaskDescriptionChars: number;
  private readonly smartEconomyToolOutputStringLimit: number;
  private readonly smartEconomyToolOutputSerializedLimit: number;
  private readonly smartEconomyHttpToolMaxResponseChars: number;
  private readonly ecoOneMaxTaskDescriptionChars: number;
  private readonly ecoOneToolOutputStringLimit: number;
  private readonly ecoOneToolOutputSerializedLimit: number;
  private readonly ecoOneHttpToolMaxResponseChars: number;
  private readonly chatgptCodexMaxTaskDescriptionChars: number;
  private readonly chatgptCodexToolOutputStringLimit: number;
  private readonly chatgptCodexToolOutputSerializedLimit: number;
  private readonly chatgptCodexHttpToolMaxResponseChars: number;
  private readonly ecoTwoAutoCompactTokenLimit: number;
  private readonly ecoTwoHistoryTargetTokens: number;
  private readonly ecoTwoUserMessageTokenLimit: number;
  private readonly ecoTwoToolOutputStringLimit: number;
  private readonly ecoTwoToolOutputSerializedLimit: number;
  private readonly ecoTwoHttpToolMaxResponseChars: number;
  private readonly ecoTwoCharsPerTokenEstimate: number;
  private readonly ecoTwoMaxIdenticalToolAttempts: number;
  private readonly ecoTwoLoopHistorySize: number;
  private readonly ecoTwoLoopStates: WeakMap<SandboxJob, EcoTwoLoopState> = new WeakMap();
  private readonly ecoThreeAutoCompactTokenLimit: number;
  private readonly ecoThreeHistoryTargetTokens: number;
  private readonly ecoThreeUserMessageTokenLimit: number;
  private readonly ecoThreeToolOutputStringLimit: number;
  private readonly ecoThreeToolOutputSerializedLimit: number;
  private readonly ecoThreeHttpToolMaxResponseChars: number;
  private readonly ecoThreeMaxTurns: number;
  private readonly ecoThreeMaxTotalTokens: number;
  private readonly dbQueryTimeoutMs: number;
  private readonly dbMaxRows: number;
  private readonly dbConfigFromEnv?: SandboxDatabaseConfig;
  private readonly dbPools: Map<string, Pool> = new Map();
  private readonly prCreateMaxAttempts: number;
  private readonly prCreateRetryDelayMs: number;
  private readonly contextRecentMessageLimit: number;
  private readonly contextSummaryLineLimit: number;
  private readonly contextWorkingSetLimit: number;
  private readonly contextWorkingSetItemCharLimit: number;
  private readonly contextPromptGcTokenThreshold: number;
  private readonly contextPromptGcTargetTokens: number;
  private readonly contextSummaryCompactionInterval: number;
  private readonly contextSimilarityHistoryLimit: number;
  private readonly shellShortTermCacheTtlMs: number;
  private readonly shellDuplicateAlertThreshold: number;
  private readonly promptCacheRetention?: string;
  private readonly promptCacheKeyPrefix?: string;
  private readonly layeredContexts: WeakMap<SandboxJob, LayeredContextState> = new WeakMap();
  private readonly stagnationMaxAttempts: number;
  private readonly inspectionStagnationMaxAttempts: number;
  private readonly stagnationResetMs: number;
  private readonly investigationStates: WeakMap<SandboxJob, InvestigationProgressState> = new WeakMap();
  private readonly runnerEnvironmentStates: WeakMap<SandboxJob, RunnerEnvironmentState> = new WeakMap();
  private readonly codexAppServerClient?: CodexAppServerClient;
  private readonly codexTurnTimeoutMs: number;
  private readonly codexAppServerSandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';

  constructor(
    apiKey?: string,
    model = 'gpt-5-codex',
    openaiClient?: OpenAI,
    fetchImpl: (input: string | URL, init?: any) => Promise<any> = globalThis.fetch,
    codexAppServerClient?: CodexAppServerClient,
  ) {
    this.model = model;
    if (openaiClient) {
      this.openai = openaiClient;
    } else if (apiKey) {
      this.openai = buildOpenAIClient(apiKey);
    }
    this.fetchImpl = fetchImpl;
    this.codexAppServerClient = codexAppServerClient;
    this.codexTurnTimeoutMs = this.parsePositiveInteger(process.env.CODEX_APP_SERVER_TURN_TIMEOUT_MS, 120 * 60 * 1000);
    this.codexAppServerSandboxMode = this.resolveCodexAppServerSandboxMode(process.env.CODEX_APP_SERVER_SANDBOX_MODE);
    this.githubApiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';
    this.maxTaskDescriptionChars = this.parsePositiveInteger(process.env.TASK_DESCRIPTION_MAX_CHARS, 12_000);
    this.toolOutputStringLimit = this.parsePositiveInteger(process.env.TOOL_OUTPUT_STRING_LIMIT, 12_000);
    this.toolOutputSerializedLimit = this.parsePositiveInteger(process.env.TOOL_OUTPUT_SERIALIZED_LIMIT, 60_000);
    this.httpToolTimeoutMs = this.parsePositiveInteger(process.env.HTTP_TOOL_TIMEOUT_MS, 15_000);
    this.httpToolMaxResponseChars = this.parsePositiveInteger(process.env.HTTP_TOOL_MAX_RESPONSE_CHARS, 20_000);
    const configuredEconomyModel = process.env.CIFIX_MODEL_ECONOMY ?? process.env.CIFIX_ECONOMY_MODEL;
    if (configuredEconomyModel && configuredEconomyModel.trim()) {
      this.economyModel = configuredEconomyModel.trim();
    } else if (this.model === 'gpt-5-codex') {
      this.economyModel = 'gpt-4.1-mini';
    } else {
      this.economyModel = this.model;
    }

    const economyTaskLimitRaw = this.parsePositiveInteger(
      process.env.ECONOMY_TASK_DESCRIPTION_MAX_CHARS,
      Math.min(this.maxTaskDescriptionChars, 6_000),
    );
    this.economyMaxTaskDescriptionChars = Math.min(economyTaskLimitRaw, this.maxTaskDescriptionChars);

    const economyToolOutputLimitRaw = this.parsePositiveInteger(
      process.env.ECONOMY_TOOL_OUTPUT_STRING_LIMIT,
      Math.min(this.toolOutputStringLimit, 6_000),
    );
    this.economyToolOutputStringLimit = Math.min(economyToolOutputLimitRaw, this.toolOutputStringLimit);

    const economyToolOutputSerializedLimitRaw = this.parsePositiveInteger(
      process.env.ECONOMY_TOOL_OUTPUT_SERIALIZED_LIMIT,
      Math.min(this.toolOutputSerializedLimit, 15_000),
    );
    this.economyToolOutputSerializedLimit = Math.min(
      economyToolOutputSerializedLimitRaw,
      this.toolOutputSerializedLimit,
    );

    const economyHttpMaxCharsRaw = this.parsePositiveInteger(
      process.env.ECONOMY_HTTP_TOOL_MAX_RESPONSE_CHARS,
      Math.min(this.httpToolMaxResponseChars, 8_000),
    );
    this.economyHttpToolMaxResponseChars = Math.min(economyHttpMaxCharsRaw, this.httpToolMaxResponseChars);

    const smartEconomyTaskLimitRaw = this.parsePositiveInteger(
      process.env.SMART_ECONOMY_TASK_DESCRIPTION_MAX_CHARS,
      Math.min(this.maxTaskDescriptionChars, 10_000),
    );
    this.smartEconomyMaxTaskDescriptionChars = Math.min(smartEconomyTaskLimitRaw, this.maxTaskDescriptionChars);

    const smartEconomyToolOutputLimitRaw = this.parsePositiveInteger(
      process.env.SMART_ECONOMY_TOOL_OUTPUT_STRING_LIMIT,
      Math.min(this.toolOutputStringLimit, 10_000),
    );
    this.smartEconomyToolOutputStringLimit = Math.min(
      smartEconomyToolOutputLimitRaw,
      this.toolOutputStringLimit,
    );

    const smartEconomyToolOutputSerializedLimitRaw = this.parsePositiveInteger(
      process.env.SMART_ECONOMY_TOOL_OUTPUT_SERIALIZED_LIMIT,
      Math.min(this.toolOutputSerializedLimit, 40_000),
    );
    this.smartEconomyToolOutputSerializedLimit = Math.min(
      smartEconomyToolOutputSerializedLimitRaw,
      this.toolOutputSerializedLimit,
    );

    const smartEconomyHttpMaxCharsRaw = this.parsePositiveInteger(
      process.env.SMART_ECONOMY_HTTP_TOOL_MAX_RESPONSE_CHARS,
      Math.min(this.httpToolMaxResponseChars, 15_000),
    );
    this.smartEconomyHttpToolMaxResponseChars = Math.min(
      smartEconomyHttpMaxCharsRaw,
      this.httpToolMaxResponseChars,
    );

    const ecoOneTaskLimitRaw = this.parsePositiveInteger(
      process.env.ECO1_TASK_DESCRIPTION_MAX_CHARS,
      Math.min(this.maxTaskDescriptionChars, 5_000),
    );
    this.ecoOneMaxTaskDescriptionChars = Math.min(ecoOneTaskLimitRaw, this.maxTaskDescriptionChars);

    const ecoOneToolOutputLimitRaw = this.parsePositiveInteger(
      process.env.ECO1_TOOL_OUTPUT_STRING_LIMIT,
      Math.min(this.toolOutputStringLimit, 4_000),
    );
    this.ecoOneToolOutputStringLimit = Math.min(ecoOneToolOutputLimitRaw, this.toolOutputStringLimit);

    const ecoOneToolOutputSerializedLimitRaw = this.parsePositiveInteger(
      process.env.ECO1_TOOL_OUTPUT_SERIALIZED_LIMIT,
      Math.min(this.toolOutputSerializedLimit, 12_000),
    );
    this.ecoOneToolOutputSerializedLimit = Math.min(
      ecoOneToolOutputSerializedLimitRaw,
      this.toolOutputSerializedLimit,
    );

    const ecoOneHttpMaxCharsRaw = this.parsePositiveInteger(
      process.env.ECO1_HTTP_TOOL_MAX_RESPONSE_CHARS,
      Math.min(this.httpToolMaxResponseChars, 6_000),
    );
    this.ecoOneHttpToolMaxResponseChars = Math.min(
      ecoOneHttpMaxCharsRaw,
      this.httpToolMaxResponseChars,
    );

    const chatgptCodexTaskLimitRaw = this.parsePositiveInteger(
      process.env.CHATGPT_CODEX_TASK_DESCRIPTION_MAX_CHARS,
      Math.min(this.maxTaskDescriptionChars, 9_000),
    );
    this.chatgptCodexMaxTaskDescriptionChars = Math.min(
      chatgptCodexTaskLimitRaw,
      this.maxTaskDescriptionChars,
    );

    const chatgptCodexToolOutputLimitRaw = this.parsePositiveInteger(
      process.env.CHATGPT_CODEX_TOOL_OUTPUT_STRING_LIMIT,
      Math.min(this.toolOutputStringLimit, 9_000),
    );
    this.chatgptCodexToolOutputStringLimit = Math.min(
      chatgptCodexToolOutputLimitRaw,
      this.toolOutputStringLimit,
    );

    const chatgptCodexToolOutputSerializedLimitRaw = this.parsePositiveInteger(
      process.env.CHATGPT_CODEX_TOOL_OUTPUT_SERIALIZED_LIMIT,
      Math.min(this.toolOutputSerializedLimit, 30_000),
    );
    this.chatgptCodexToolOutputSerializedLimit = Math.min(
      chatgptCodexToolOutputSerializedLimitRaw,
      this.toolOutputSerializedLimit,
    );

    const chatgptCodexHttpMaxCharsRaw = this.parsePositiveInteger(
      process.env.CHATGPT_CODEX_HTTP_TOOL_MAX_RESPONSE_CHARS,
      Math.min(this.httpToolMaxResponseChars, 14_000),
    );
    this.chatgptCodexHttpToolMaxResponseChars = Math.min(
      chatgptCodexHttpMaxCharsRaw,
      this.httpToolMaxResponseChars,
    );

    this.ecoTwoAutoCompactTokenLimit = this.parsePositiveInteger(
      process.env.ECO2_AUTO_COMPACT_TOKEN_LIMIT,
      1_000_000,
    );
    const ecoTwoHistoryTargetRaw = this.parsePositiveInteger(
      process.env.ECO2_HISTORY_TARGET_TOKENS,
      Math.min(this.ecoTwoAutoCompactTokenLimit, 800_000),
    );
    this.ecoTwoHistoryTargetTokens = Math.min(
      ecoTwoHistoryTargetRaw,
      this.ecoTwoAutoCompactTokenLimit,
    );

    const ecoTwoUserLimitRaw = this.parsePositiveInteger(
      process.env.ECO2_USER_MESSAGE_TOKEN_LIMIT,
      35_000,
    );
    this.ecoTwoUserMessageTokenLimit = Math.min(ecoTwoUserLimitRaw, 50_000);

    const ecoTwoToolOutputLimitRaw = this.parsePositiveInteger(
      process.env.ECO2_TOOL_OUTPUT_STRING_LIMIT,
      Math.min(this.toolOutputStringLimit, 5_000),
    );
    this.ecoTwoToolOutputStringLimit = Math.min(
      ecoTwoToolOutputLimitRaw,
      this.toolOutputStringLimit,
    );

    const ecoTwoToolOutputSerializedLimitRaw = this.parsePositiveInteger(
      process.env.ECO2_TOOL_OUTPUT_SERIALIZED_LIMIT,
      Math.min(this.toolOutputSerializedLimit, 18_000),
    );
    this.ecoTwoToolOutputSerializedLimit = Math.min(
      ecoTwoToolOutputSerializedLimitRaw,
      this.toolOutputSerializedLimit,
    );

    const ecoTwoHttpMaxCharsRaw = this.parsePositiveInteger(
      process.env.ECO2_HTTP_TOOL_MAX_RESPONSE_CHARS,
      Math.min(this.httpToolMaxResponseChars, 10_000),
    );
    this.ecoTwoHttpToolMaxResponseChars = Math.min(
      ecoTwoHttpMaxCharsRaw,
      this.httpToolMaxResponseChars,
    );

    this.ecoTwoCharsPerTokenEstimate = this.parsePositiveInteger(
      process.env.ECO2_APPROX_CHARS_PER_TOKEN,
      4,
    );

    this.ecoTwoMaxIdenticalToolAttempts = Math.max(
      2,
      this.parsePositiveInteger(process.env.ECO2_MAX_IDENTICAL_TOOL_ATTEMPTS, 3),
    );
    this.ecoTwoLoopHistorySize = Math.max(
      this.ecoTwoMaxIdenticalToolAttempts,
      this.parsePositiveInteger(
        process.env.ECO2_LOOP_HISTORY_SIZE,
        this.ecoTwoMaxIdenticalToolAttempts * 3,
      ),
    );
    this.stagnationMaxAttempts = Math.max(
      2,
      this.parsePositiveInteger(process.env.INVESTIGATION_STAGNATION_MAX_ATTEMPTS, 3),
    );
    this.inspectionStagnationMaxAttempts = Math.max(
      this.stagnationMaxAttempts,
      this.parsePositiveInteger(process.env.INVESTIGATION_INSPECTION_MAX_ATTEMPTS, 6),
    );
    this.stagnationResetMs = Math.max(
      10_000,
      this.parsePositiveInteger(process.env.INVESTIGATION_STAGNATION_RESET_MS, 120_000),
    );

    this.ecoThreeAutoCompactTokenLimit = this.parsePositiveInteger(
      process.env.ECO3_AUTO_COMPACT_TOKEN_LIMIT,
      600_000,
    );
    const ecoThreeHistoryTargetRaw = this.parsePositiveInteger(
      process.env.ECO3_HISTORY_TARGET_TOKENS,
      Math.min(this.ecoThreeAutoCompactTokenLimit, 450_000),
    );
    this.ecoThreeHistoryTargetTokens = Math.min(
      ecoThreeHistoryTargetRaw,
      this.ecoThreeAutoCompactTokenLimit,
    );
    const ecoThreeUserLimitRaw = this.parsePositiveInteger(
      process.env.ECO3_USER_MESSAGE_TOKEN_LIMIT,
      18_000,
    );
    this.ecoThreeUserMessageTokenLimit = Math.min(ecoThreeUserLimitRaw, 30_000);
    const ecoThreeToolOutputLimitRaw = this.parsePositiveInteger(
      process.env.ECO3_TOOL_OUTPUT_STRING_LIMIT,
      Math.min(this.toolOutputStringLimit, 3_000),
    );
    this.ecoThreeToolOutputStringLimit = Math.min(
      ecoThreeToolOutputLimitRaw,
      this.toolOutputStringLimit,
    );
    const ecoThreeToolOutputSerializedLimitRaw = this.parsePositiveInteger(
      process.env.ECO3_TOOL_OUTPUT_SERIALIZED_LIMIT,
      Math.min(this.toolOutputSerializedLimit, 12_000),
    );
    this.ecoThreeToolOutputSerializedLimit = Math.min(
      ecoThreeToolOutputSerializedLimitRaw,
      this.toolOutputSerializedLimit,
    );
    const ecoThreeHttpMaxCharsRaw = this.parsePositiveInteger(
      process.env.ECO3_HTTP_TOOL_MAX_RESPONSE_CHARS,
      Math.min(this.httpToolMaxResponseChars, 8_000),
    );
    this.ecoThreeHttpToolMaxResponseChars = Math.min(
      ecoThreeHttpMaxCharsRaw,
      this.httpToolMaxResponseChars,
    );
    this.ecoThreeMaxTurns = this.parsePositiveInteger(process.env.ECO3_MAX_TURNS, 600);
    this.ecoThreeMaxTotalTokens = this.parsePositiveInteger(
      process.env.ECO3_MAX_TOTAL_TOKENS,
      1_600_000,
    );

    this.dbQueryTimeoutMs = this.parsePositiveInteger(process.env.DB_QUERY_TIMEOUT_MS, 10_000);
    this.dbMaxRows = this.parsePositiveInteger(process.env.DB_QUERY_MAX_ROWS, 200);
    this.prCreateMaxAttempts = Math.max(1, this.parsePositiveInteger(process.env.PR_CREATE_RETRY_ATTEMPTS, 3));
    this.prCreateRetryDelayMs = this.parsePositiveInteger(process.env.PR_CREATE_RETRY_DELAY_MS, 1_500);
    this.contextRecentMessageLimit = Math.max(4, this.parsePositiveInteger(process.env.CONTEXT_RECENT_MESSAGE_LIMIT, 14));
    this.contextSummaryLineLimit = Math.max(20, this.parsePositiveInteger(process.env.CONTEXT_SUMMARY_LINE_LIMIT, 90));
    this.contextWorkingSetLimit = Math.max(1, this.parsePositiveInteger(process.env.CONTEXT_WORKING_SET_LIMIT, 10));
    this.contextWorkingSetItemCharLimit = this.parsePositiveInteger(
      process.env.CONTEXT_WORKING_SET_ITEM_CHAR_LIMIT,
      1_200,
    );
    this.contextPromptGcTokenThreshold = this.parsePositiveInteger(
      process.env.CONTEXT_PROMPT_GC_TOKEN_THRESHOLD,
      40_000,
    );
    const defaultPromptTarget = Math.max(
      1,
      Math.min(this.contextPromptGcTokenThreshold - 2_000, 30_000),
    );
    const parsedPromptTarget = this.parsePositiveInteger(
      process.env.CONTEXT_PROMPT_GC_TARGET_TOKENS,
      defaultPromptTarget,
    );
    this.contextPromptGcTargetTokens = Math.min(
      Math.max(1, this.contextPromptGcTokenThreshold - 1_000),
      parsedPromptTarget,
    );
    if (
      this.contextPromptGcTargetTokens <= 0
      || this.contextPromptGcTargetTokens >= this.contextPromptGcTokenThreshold
    ) {
      this.contextPromptGcTargetTokens = Math.max(
        1,
        Math.floor(this.contextPromptGcTokenThreshold * 0.8),
      );
    }
    this.contextSummaryCompactionInterval = Math.max(
      1,
      this.parsePositiveInteger(process.env.CONTEXT_SUMMARY_COMPACTION_INTERVAL, 4),
    );
    this.contextSimilarityHistoryLimit = Math.max(
      3,
      this.parsePositiveInteger(process.env.CONTEXT_SIMILARITY_HISTORY_LIMIT, 20),
    );
    this.shellShortTermCacheTtlMs = Math.max(
      1_000,
      this.parsePositiveInteger(process.env.RUN_SHELL_SHORT_CACHE_TTL_MS, 10_000),
    );
    this.shellDuplicateAlertThreshold = this.parsePercentage(
      process.env.RUN_SHELL_DUPLICATE_ALERT_THRESHOLD,
      0.1,
    );
    const configuredPromptCacheRetention = process.env.OPENAI_PROMPT_CACHE_RETENTION?.trim();
    this.promptCacheRetention = configuredPromptCacheRetention && configuredPromptCacheRetention.length > 0
      ? configuredPromptCacheRetention
      : '24h';
    const configuredPromptCacheKeyPrefix = process.env.OPENAI_PROMPT_CACHE_KEY_PREFIX?.trim();
    this.promptCacheKeyPrefix = configuredPromptCacheKeyPrefix && configuredPromptCacheKeyPrefix.length > 0
      ? configuredPromptCacheKeyPrefix
      : undefined;
    this.dbConfigFromEnv = this.loadDatabaseConfig();
  }

  async process(job: SandboxJob): Promise<void> {
    if (job.cancelRequested) {
      const now = new Date().toISOString();
      job.status = 'CANCELLED';
      job.startedAt = job.startedAt ?? now;
      job.finishedAt = job.finishedAt ?? now;
      job.updatedAt = now;
      job.durationMs = job.durationMs ?? 0;
      return;
    }

    job.profile = (job.profile ?? 'STANDARD') as SandboxProfile;
    const resolvedModel = this.resolveModel(job);
    job.model = resolvedModel;
    job.timeoutCount = job.timeoutCount ?? 0;
    job.interactions = Array.isArray(job.interactions) ? job.interactions : [];
    job.interactionSequence = Number.isFinite(job.interactionSequence) ? job.interactionSequence : 0;
    job.httpGetCount = job.httpGetCount ?? 0;
    job.httpGetSuccessCount = job.httpGetSuccessCount ?? 0;
    job.httpRequests = Array.isArray(job.httpRequests) ? job.httpRequests : [];
    job.dbQueryCount = job.dbQueryCount ?? 0;

    const start = new Date();
    job.startedAt = job.startedAt ?? start.toISOString();
    job.updatedAt = job.startedAt;
    job.status = 'RUNNING';

    let workspace: string | undefined;
    let repoPath: string | undefined;

    try {
      this.ensureNotCancelled(job);
      workspace = await this.prepareWorkspace(job);
      repoPath = path.join(workspace, 'repo');
      job.sandboxPath = workspace;
      this.log(job, `workspace criado em ${workspace}`);
      this.log(job, `perfil ${job.profile} selecionado; modelo ${resolvedModel}`);
      if (this.isEconomy(job)) {
        this.log(
          job,
          `modo econômico: limite prompt=${this.economyMaxTaskDescriptionChars}, toolOutput=${this.economyToolOutputStringLimit}, http_get=${this.economyHttpToolMaxResponseChars}`,
        );
      } else if (this.isSmartEconomy(job)) {
        this.log(
          job,
          `modo econômico inteligente: limite prompt=${this.smartEconomyMaxTaskDescriptionChars}, toolOutput=${this.smartEconomyToolOutputStringLimit}, http_get=${this.smartEconomyHttpToolMaxResponseChars}`,
        );
      } else if (this.isEcoOne(job)) {
        this.log(
          job,
          `modo ECO-1: limite prompt=${this.ecoOneMaxTaskDescriptionChars}, toolOutput=${this.ecoOneToolOutputStringLimit}, http_get=${this.ecoOneHttpToolMaxResponseChars}`,
        );
      } else if (this.isEcoTwo(job)) {
        this.log(
          job,
          `modo ECO-2: auto-compact=${this.ecoTwoAutoCompactTokenLimit} tokens, histórico alvo=${this.ecoTwoHistoryTargetTokens}, toolOutput=${this.ecoTwoToolOutputStringLimit}, http_get=${this.ecoTwoHttpToolMaxResponseChars}`,
        );
      } else if (this.isEcoThree(job)) {
        this.log(
          job,
          `modo ECO-3: auto-compact=${this.ecoThreeAutoCompactTokenLimit} tokens, histórico alvo=${this.ecoThreeHistoryTargetTokens}, toolOutput=${this.ecoThreeToolOutputStringLimit}, http_get=${this.ecoThreeHttpToolMaxResponseChars}, turns=${this.ecoThreeMaxTurns}, tokens_max=${this.ecoThreeMaxTotalTokens}`,
        );
      } else if (this.isChatgptCodexFamily(job)) {
        this.log(
          job,
          `modo ${this.isChatgptCodexMarketing(job) ? 'ChatGPT Codex MKT' : 'ChatGPT Codex'}: limite prompt=${this.chatgptCodexMaxTaskDescriptionChars}, toolOutput=${this.chatgptCodexToolOutputStringLimit}, http_get=${this.chatgptCodexHttpToolMaxResponseChars}`,
        );
      }

      this.ensureNotCancelled(job);
      const githubAuth = this.resolveGithubAuth(job);
      if (githubAuth.token) {
        this.log(
          job,
          `token GitHub obtido de ${githubAuth.source} será usado para clone, push e criação de PR`,
        );
      } else {
        this.log(job, 'nenhum token GitHub configurado; operações autenticadas podem falhar');
      }

      const cloneUrl = buildAuthRepoUrl(job.repoUrl, githubAuth.token, githubAuth.username);
      this.log(job, `clonando repositório ${redactUrlCredentials(cloneUrl)} (branch ${job.branch})`);
      await this.cloneRepository(job, repoPath!, cloneUrl);
      this.ensureNotCancelled(job);
      const baseCommit = await this.getHeadCommit(repoPath!);
      this.ensureNotCancelled(job);
      await this.checkoutExistingWorkBranchForContext(job, repoPath!);
      this.ensureNotCancelled(job);
      await this.runRunnerPreflight(job, repoPath!);
      this.ensureNotCancelled(job);

      this.ensureNotCancelled(job);
      this.log(job, `iniciando interação com o modelo do sandbox (${resolvedModel})`);
      const summary = this.isChatgptCodexFamily(job)
        ? await this.runWithCodexAppServer(job, repoPath!, resolvedModel)
        : await this.runWithOpenAIResponsesApi(job, repoPath!, resolvedModel);
      job.summary = summary;
      this.ensureNotCancelled(job);
      job.changedFiles = await this.collectChangedFiles(repoPath!, baseCommit, job);
      this.ensureNotCancelled(job);
      job.patch = await this.generatePatch(repoPath!, baseCommit, job);
      this.ensureNotCancelled(job);
      await this.runConfiguredTestCommand(job, repoPath!);
      this.advanceInvestigationStage(job, 'VALIDAR', 'testes configurados executados');
      this.ensureNotCancelled(job);
      await this.maybeCreatePullRequest(job, repoPath!, githubAuth, baseCommit, job.patch);
      this.advanceInvestigationStage(job, 'ENCERRAR', 'fluxo finalizado após validação');
      this.log(job, 'job concluído com sucesso, coletando patch e arquivos alterados');
      job.status = 'COMPLETED';
      job.finishedAt = new Date().toISOString();
    } catch (error) {
      if (error instanceof JobCancelledError) {
        job.status = 'CANCELLED';
        job.error = undefined;
        this.log(job, 'job cancelado pelo usuário');
      } else {
        job.status = 'FAILED';
        job.error = error instanceof Error ? error.message : String(error);
        this.log(job, `falha ao processar job: ${job.error}`);
      }
    } finally {
      this.logContextKpis(job);
      if (workspace) {
        this.log(job, `limpando workspace ${workspace}`);
        await this.cleanup(workspace);
      }
      await this.disposeDbPool(job.jobId);
      const finished = job.finishedAt ? new Date(job.finishedAt) : new Date();
      job.finishedAt = finished.toISOString();
      job.updatedAt = job.finishedAt;
      if (job.startedAt) {
        const startMs = Date.parse(job.startedAt);
        if (Number.isFinite(startMs)) {
          job.durationMs = Math.max(0, finished.getTime() - startMs);
        }
      }
      await this.sendCallback(job);
    }
  }

  private ensureNotCancelled(job: SandboxJob): void {
    if (job.cancelRequested) {
      throw new JobCancelledError();
    }
  }

  private async prepareWorkspace(job: SandboxJob): Promise<string> {
    const baseDir = path.resolve(process.env.SANDBOX_WORKDIR ?? os.tmpdir());
    const sandboxEnv = process.env.SANDBOX_WORKDIR ?? '<não definido>';
    this.log(job, `preparando workspace (SANDBOX_WORKDIR=${sandboxEnv}) em ${baseDir}`);
    try {
      await fs.mkdir(baseDir, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(job, `falha ao criar diretório base ${baseDir}: ${message}`);
      throw new Error(`não foi possível preparar diretório base ${baseDir}: ${message}`);
    }

    try {
      const workspace = await fs.mkdtemp(path.join(baseDir, `ai-hub-${job.jobId}-`));
      this.log(job, `workspace temporário usando ${baseDir} criado com prefixo ai-hub-${job.jobId}-`);
      return workspace;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const baseDirStatus = await this.describePathStatus(baseDir);
      this.log(
        job,
        `falha ao criar workspace temporário em ${baseDir}: ${message} (status do diretório base: ${baseDirStatus})`,
      );
      throw new Error(`não foi possível criar workspace temporário em ${baseDir}: ${message}`);
    }
  }

  private resolveGithubAuth(job: SandboxJob): { token?: string; username: string; source: string } {
    const username = process.env.GITHUB_CLONE_USERNAME ?? 'x-access-token';
    const candidates: Array<{ token?: string; source: string }> = [
      { token: job.githubToken, source: 'payload.githubToken' },
      { token: process.env.GITHUB_CLONE_TOKEN, source: 'GITHUB_CLONE_TOKEN' },
      { token: process.env.GITHUB_TOKEN, source: 'GITHUB_TOKEN' },
      { token: process.env.GITHUB_PR_TOKEN, source: 'GITHUB_PR_TOKEN' },
      { token: extractTokenFromRepoUrl(job.repoUrl), source: 'repoUrl' },
    ];

    const selected = candidates.find((candidate) => candidate.token);
    return { token: selected?.token, username, source: selected?.source ?? 'nenhum' };
  }

  private async cleanup(workspace: string): Promise<void> {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch (err) {
      // noop
    }
  }

  private async cloneRepository(job: SandboxJob, repoPath: string, cloneUrl: string): Promise<void> {
    await exec(`git clone --branch ${job.branch} --depth 1 ${cloneUrl} ${repoPath}`);
    if (job.commitHash) {
      this.log(job, `checando commit ${job.commitHash}`);
      await exec(`git checkout ${job.commitHash}`, { cwd: repoPath });
    }
  }

  private buildTools(repoPath: string) {
    return [
      {
        type: 'function' as const,
        name: 'run_shell',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string', description: 'Diretório relativo ao repo' },
          },
          required: ['command', 'cwd'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Executa um comando de shell dentro do sandbox clonado',
      },
      {
        type: 'function' as const,
        name: 'read_file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Lê um arquivo do repositório clonado',
      },
      {
        type: 'function' as const,
        name: 'read_image',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Caminho relativo de uma imagem PNG/JPG/WebP/GIF dentro do repositório clonado' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Lê uma imagem local do sandbox e a reenvia ao modelo como input visual multimodal',
      },
      {
        type: 'function' as const,
        name: 'fetch_image',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL pública de uma imagem PNG/JPG/WebP/GIF externa' },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Cabeçalhos opcionais; Authorization é ignorado',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Baixa uma imagem pública externa e a reenvia ao modelo como input visual multimodal',
      },
      {
        type: 'function' as const,
        name: 'write_file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Escreve um arquivo dentro do repositório clonado',
      },
      {
        type: 'function' as const,
        name: 'http_get',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL http(s) pública para consulta' },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Cabeçalhos opcionais; Authorization é ignorado',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
        strict: true,
        description:
          'Busca um recurso público via HTTP GET (bloqueia hosts internos e localhost); consulte documentação oficial de APIs externas antes de integrá-las',
      },
      {
        type: 'function' as const,
        name: 'WebSearch',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL http(s) pública para consulta' },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Cabeçalhos opcionais; Authorization é ignorado',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
        strict: true,
        description:
          'Alias de http_get para buscar conteúdos públicos na web bloqueando hosts internos/localhost',
      },
      {
        type: 'function' as const,
        name: 'db_query',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Instrução SQL de leitura (apenas SELECT)' },
            limit: {
              type: 'integer',
              description: `Limite máximo de linhas a retornar (padrão ${this.dbMaxRows}, máximo ${this.dbMaxRows})`,
            },
          },
          required: ['query', 'limit'],
          additionalProperties: false,
        },
        strict: true,
        description: 'Executa uma consulta SELECT no banco de dados configurado para este ambiente (não usa o banco principal da aplicação)',
      },
    ];
  }


  private resolveOpenAIClient(job: SandboxJob): OpenAI {
    if (this.isChatgptCodexFamily(job)) {
      throw new Error(`${job.profile} deve executar exclusivamente via Codex App Server, sem OpenAI Responses API`);
    }

    if (!this.openai) {
      throw new Error('OPENAI_API_KEY não configurada no sandbox orchestrator');
    }
    return this.openai;
  }

  private resolveCodexAppServerSandboxMode(value: string | undefined): 'read-only' | 'workspace-write' | 'danger-full-access' {
    const normalized = value?.trim();
    if (!normalized) {
      return 'danger-full-access';
    }
    if (normalized === 'read-only' || normalized === 'workspace-write' || normalized === 'danger-full-access') {
      return normalized;
    }
    throw new Error(
      `CODEX_APP_SERVER_SANDBOX_MODE inválido: ${normalized}. Use read-only, workspace-write ou danger-full-access.`,
    );
  }

  private async runWithOpenAIResponsesApi(job: SandboxJob, repoPath: string, model: string): Promise<string> {
    const openai = this.resolveOpenAIClient(job);
    return this.runCodexLoop(job, repoPath, model, openai);
  }

  private async runWithCodexAppServer(job: SandboxJob, repoPath: string, model: string): Promise<string> {
    const client = this.codexAppServerClient;
    if (!client || !client.isReady()) {
      throw new Error('CODEX_APP_SERVER_UNAVAILABLE');
    }

    const account = await readCodexAccount(client);
    if (!account.executable) {
      throw new Error(account.blockReason || 'CODEX_NOT_AUTHENTICATED');
    }
    this.recordInteraction(job, 'OUTBOUND', this.safeStringify({
      method: 'thread/start',
      params: { model, cwd: repoPath, approvalPolicy: 'never', sandbox: this.codexAppServerSandboxMode, serviceName: 'ai_hub' },
    }));
    const thread = await client.request<Record<string, unknown>>('thread/start', {
      model,
      cwd: repoPath,
      approvalPolicy: 'never',
      sandbox: this.codexAppServerSandboxMode,
      serviceName: 'ai_hub',
    });
    const threadId = this.extractCodexId(thread, ['threadId', 'id'], 'thread.id');
    if (!threadId) {
      throw new Error('CODEX_THREAD_START_FAILED');
    }
    this.log(job, `Codex App Server thread/start concluído threadId=${threadId}`);

    let completed = false;
    let failedReason: string | undefined;
    let summary = '';
    let finalAgentMessage = '';
    let streamingAgentMessage = '';
    let firstEventAt: number | undefined;
    const startedAt = Date.now();
    const unsubscribeCallbacks = [
      client.onNotification('item/agentMessage/delta', (params) => {
        firstEventAt = firstEventAt ?? Date.now();
        const delta = this.extractCodexText(params) ?? '';
        if (delta) {
          streamingAgentMessage += delta;
          this.recordInteraction(job, 'INBOUND', delta);
        }
      }),
      client.onNotification('item/completed', (params) => {
        firstEventAt = firstEventAt ?? Date.now();
        const text = this.extractCodexAgentMessageText(params);
        if (text) {
          finalAgentMessage = text;
          summary = text;
          this.recordInteraction(job, 'INBOUND', text);
        }
        this.log(job, `Codex App Server item/completed ${this.safeStringify(this.sanitizeCodexEvent(params))}`);
      }),
      client.onNotification('item/started', (params) => {
        firstEventAt = firstEventAt ?? Date.now();
        this.log(job, `Codex App Server item/started ${this.safeStringify(this.sanitizeCodexEvent(params))}`);
      }),
      client.onNotification('turn/completed', (params) => {
        firstEventAt = firstEventAt ?? Date.now();
        const status = this.extractCodexStatus(params);
        const text = this.extractCodexText(params);
        if (text) {
          summary = text;
          this.recordInteraction(job, 'INBOUND', text);
        }
        if (status && !['completed', 'succeeded', 'success', 'ok'].includes(status)) {
          failedReason = `CODEX_TURN_FAILED: ${status}`;
        }
        completed = true;
      }),
      client.onNotification('error', (params) => {
        firstEventAt = firstEventAt ?? Date.now();
        failedReason = this.extractCodexErrorMessage(params) ?? 'CODEX_APP_SERVER_ERROR';
        this.log(job, `Codex App Server error ${this.safeStringify(this.sanitizeCodexEvent(params))}`);
      }),
    ];

    try {
      const turnParams = {
        threadId,
        input: this.buildCodexAppServerInput(job),
      };
      this.recordInteraction(job, 'OUTBOUND', this.safeStringify({ method: 'turn/start', params: turnParams }));
      const turn = await client.request<Record<string, unknown>>('turn/start', turnParams);
      const turnId = this.extractCodexId(turn, ['turnId', 'id'], 'turn.id') ?? 'n/d';
      this.log(job, `Codex App Server turn/start concluído threadId=${threadId} turnId=${turnId}`);
      const immediateStatus = this.extractCodexStatus(turn);
      const immediateText = this.extractCodexText(turn);
      if (immediateText) {
        summary = immediateText;
      }
      if (immediateStatus && ['completed', 'succeeded', 'success', 'ok'].includes(immediateStatus)) {
        completed = true;
      }
      await this.waitForCodexTurn(job, () => completed, () => failedReason);
      if (failedReason) {
        throw new Error(failedReason);
      }
      const firstEventMs = firstEventAt ? firstEventAt - startedAt : undefined;
      this.log(job, `Codex App Server turn/completed recebido threadId=${threadId} turnId=${turnId}${firstEventMs !== undefined ? ` firstEventMs=${firstEventMs}` : ''}`);
      return (finalAgentMessage || summary || streamingAgentMessage).trim() || 'Codex App Server concluiu o turno sem mensagem final.';
    } finally {
      unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
    }
  }


  private buildSandboxEmailInstruction(): string {
    const smtpHost = process.env.SANDBOX_SMTP_HOST?.trim() || 'sandbox-mail';
    const smtpPort = process.env.SANDBOX_SMTP_PORT?.trim() || '1025';
    const webUrl = process.env.SANDBOX_MAIL_WEB_URL?.trim() || 'http://sandbox-mail:8025';
    const apiUrl = process.env.SANDBOX_MAIL_API_URL?.trim() || 'http://sandbox-mail:8025/api/v1';
    return `A sandbox disponibiliza um cliente de e-mail descartável para testes: configure SMTP em ${smtpHost}:${smtpPort}, use destinatários como teste+<jobId>@sandbox.local, consulte a API em ${apiUrl} (por exemplo, GET ${apiUrl}/messages) ou a UI interna em ${webUrl}, e nunca use credenciais reais de SMTP para validações.`;
  }

  private buildCodexAppServerInput(job: SandboxJob): Array<Record<string, string>> {
    const bestAnswerInstruction = 'Oriente sua execução para produzir a melhor resposta possível: investigue, valide e refine a solução sem encurtar a análise por preocupação com limites de tempo ou de interações.';
    const localDevelopmentInstruction = 'Sempre que estiver fazendo um desenvolvimento mais complexo, monte um ambiente local, execute o que pretende desenvolver e ajuste iterativamente até conseguir o funcionamento desejado, registrando qualquer limitação real de ambiente que impeça a execução local.';
    const marketingObjectiveInstruction = 'Nosso objetivo principal é gerar vendas em larga escala de produtos digitais de alto valor com comunicação sedutora pelo sistema Marketing Hub.';
    const marketingDecisionInstruction = 'Nos pontos mais importantes do fluxo de solução, aplique um mecanismo explícito de raciocínio: elabore pelo menos 3 alternativas boas, compare benefícios, riscos, custo/esforço e aderência ao objetivo do usuário, escolha a melhor para a situação e siga por ela registrando a justificativa de forma objetiva.';
    const emailTestingInstruction = this.buildSandboxEmailInstruction();
    const taskDescription = this.isChatgptCodexMarketing(job)
      ? `Modo Codex ChatGPT MKT ativo: baixe e analise o repositório como fonte de relatórios de marketing, principalmente arquivos Markdown. Priorize campanhas, estratégias, funis, canais, criativos, métricas, resultados, aprendizados e oportunidades de marketing digital. Gere orientações acionáveis de melhoria em português e só prepare mudanças para PR quando o usuário solicitar explicitamente. ${marketingObjectiveInstruction} ${bestAnswerInstruction} ${localDevelopmentInstruction} ${marketingDecisionInstruction} ${emailTestingInstruction}

${job.taskDescription}`
      : this.isChatgptCodex(job)
        ? `Modo Codex ChatGPT ativo: ${bestAnswerInstruction} ${localDevelopmentInstruction}

${job.taskDescription}`
        : job.taskDescription;
    return [
      { type: 'text', text: taskDescription },
      ...(job.imageAttachments ?? []).map((attachment) => ({
        type: 'image',
        url: attachment.dataUrl,
      })),
    ];
  }

  private async waitForCodexTurn(job: SandboxJob, isCompleted: () => boolean, failureReason: () => string | undefined): Promise<void> {
    const startedAt = Date.now();
    while (!isCompleted()) {
      this.ensureNotCancelled(job);
      const failure = failureReason();
      if (failure) {
        throw new Error(failure);
      }
      if (Date.now() - startedAt > this.codexTurnTimeoutMs) {
        throw new Error('CODEX_TURN_INTERRUPTED');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private extractCodexId(value: unknown, keys: string[], nestedKey?: string): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    if (nestedKey) {
      const [outer, inner] = nestedKey.split('.');
      const nested = record[outer];
      if (nested && typeof nested === 'object') {
        const candidate = (nested as Record<string, unknown>)[inner];
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
    }
    return undefined;
  }

  private extractCodexAgentMessageText(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const item = record.item;
    if (item && typeof item === 'object') {
      const itemRecord = item as Record<string, unknown>;
      const type = typeof itemRecord.type === 'string' ? itemRecord.type.toLowerCase() : '';
      const text = itemRecord.text;
      if ((!type || type === 'agentmessage' || type === 'agent_message') && typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    }
    return undefined;
  }

  private extractCodexText(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const candidates = [record.text, record.delta, record.message, record.summary, record.output, record.result];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
    const item = record.item;
    if (item && typeof item === 'object') {
      return this.extractCodexText(item);
    }
    return undefined;
  }

  private extractCodexStatus(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const status = record.status ?? record.outcome;
    return typeof status === 'string' ? status.toLowerCase() : undefined;
  }

  private extractCodexErrorMessage(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const directMessage = record.message;
    if (typeof directMessage === 'string' && directMessage.trim()) {
      return directMessage.trim();
    }
    const error = record.error;
    if (error && typeof error === 'object') {
      const nestedMessage = (error as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage.trim();
      }
    }
    return undefined;
  }

  private sanitizeCodexEvent(value: unknown): unknown {
    return sanitizeOpenAIExchange(value);
  }

  private async runCodexLoop(job: SandboxJob, repoPath: string, model: string, openai: OpenAI): Promise<string> {
    this.ensureNotCancelled(job);
    job.taskDescription = this.sanitizeTaskDescription(job.taskDescription, job);

    const environmentState = this.getOrThrowRunnerEnvironmentState(job, repoPath);
    const checklist = this.buildEnvironmentChecklist(environmentState);

    const tools = this.buildTools(repoPath);
    const profileInstruction = this.isEconomy(job)
      ? `
Modo econômico ativo: minimize leituras extensas, priorize comandos curtos, escreva respostas objetivas e evite reexecuções desnecessárias.`
      : this.isSmartEconomy(job)
        ? `
Modo econômico inteligente ativo: aproveite estratégias enxutas (reutilizar resultados, evitar loops desnecessários) sem abrir mão da validação completa. Justifique quando precisar executar comandos mais longos e confirme se a cobertura da tarefa permanece adequada.`
        : this.isEcoOne(job)
          ? `
Modo ECO-1 ativo: siga o plano descrito em docs/estrategia-token/modo-eco1.md — limite o carregamento de instruções fixas (project_doc_max_bytes), corte e resuma outputs de tools antes de salvá-los, force compaction sempre que o histórico se aproximar do limite do modelo, trate imagens inline como estimativas fixas e aceite automaticamente o nudge para modelos econômicos ao atingir 90% do orçamento. Registre todas as truncagens para que o time saiba o que ficou de fora.`
          : this.isEcoTwo(job)
            ? `
Modo ECO-2 ativo: cumpra as rotinas descritas em docs/estrategia-token/modo-eco2.md — monitore total_usage_tokens e rode compactações automáticas assim que ultrapassar o limite configurado, execute uma compactação preventiva antes de cada turno e sempre que trocar para um modelo com janela menor, escolha entre compactação local e remota conforme o provedor, mantenha no máximo 35k tokens de mensagens de usuário (truncando e registrando excessos), pode chamadas de função/tool mais antigas antes de enviar o histórico para o compactador e trunque as saídas de ferramentas antes de devolvê-las ao modelo e abandone loops detectados: se precisar repetir a mesma tool explique o que mudou, caso contrário o sandbox bloqueará tentativas idênticas para poupar tokens.`
            : this.isEcoThree(job)
              ? `
Modo ECO-3 ativo: siga o protocolo descrito em docs/estrategia-token/modo-eco3.md — transforme logs longos em resumos antes de reenviá-los, limite as janelas de histórico a blocos pequenos, pare loops que ultrapassem os limites de iterações/tokens e sempre documente o que foi descartado para manter rastreabilidade.`
              : this.isChatgptCodexMarketing(job)
              ? `
Modo ChatGPT Codex MKT ativo: use a sandbox para baixar e analisar o repositório como base documental de marketing. Foque principalmente em arquivos .md com relatórios de marketing digital, campanhas, estratégias, resultados, métricas, canais, criativos e aprendizados. Gere relatórios de orientação com melhorias acionáveis para o usuário, preserve evidências dos arquivos analisados e só crie/prepare PR quando solicitado explicitamente pelo usuário. Nosso objetivo principal é gerar vendas em larga escala de produtos digitais de alto valor com comunicação sedutora pelo sistema Marketing Hub. Sempre que estiver fazendo um desenvolvimento mais complexo, monte um ambiente local, execute o que pretende desenvolver e ajuste iterativamente até conseguir o funcionamento desejado, registrando qualquer limitação real de ambiente que impeça a execução local. Nos pontos mais importantes do fluxo de solução, elabore pelo menos 3 alternativas boas, compare benefícios, riscos, custo/esforço e aderência ao objetivo, escolha a melhor para a situação e siga por ela com justificativa objetiva. ${this.buildSandboxEmailInstruction()}`
              : this.isChatgptCodex(job)
              ? `
Modo ChatGPT Codex ativo: replique a experiência do app (chatgpt.com/codex) descrita em docs/estrategia-token/chatgpt-codex.md — organize squads paralelos, abra worktrees ou diretórios codex/<squad> para separar fluxos, registre owners/risco/custos a cada checkpoint, reutilize resultados entre agentes e prefira execuções curtas em ambientes em nuvem antes de compartilhar resumos objetivos. Sempre que estiver fazendo um desenvolvimento mais complexo, monte um ambiente local, execute o que pretende desenvolver e ajuste iterativamente até conseguir o funcionamento desejado, registrando qualquer limitação real de ambiente que impeça a execução local.`
              : '';
    const userContent: Array<Record<string, string>> = [
      { type: 'input_text', text: job.taskDescription },
      ...(job.imageAttachments ?? []).map((attachment) => ({
        type: 'input_image',
        image_url: attachment.dataUrl,
        detail: 'auto',
      })),
    ];

    const messages: ResponseItem[] = [
      {
        type: 'message',
        id: this.sanitizeId('msg_system'),
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Você está operando em um sandbox isolado em ${repoPath}. Use as tools para ler, alterar arquivos e executar comandos. Test command sugerido: ${
              job.testCommand ?? 'n/d'
            }. O sandbox possui Chromium headless em /usr/bin/chromium e as variáveis CHROME_BIN, CHROMIUM_BIN, PUPPETEER_EXECUTABLE_PATH e PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH configuradas; quando a tarefa envolver UI, layout ou mudança visual, use esse navegador para validar localmente e gerar screenshot automatizado sempre que possível; use read_image para visualizar screenshots/arquivos PNG/JPG/WebP/GIF locais e fetch_image para visualizar imagens externas públicas por URL. Sempre trabalhe somente dentro do diretório do repositório. Prefira usar o comando rg para buscas recursivas em vez de grep -R, que é mais lento. Não deixe para o usuário tarefas que você consegue executar: se precisar ajustar arquivos, criar commits, atualizar PR ou escrever mensagens, faça você mesmo. Só peça intervenção humana quando for impossível concluir algo dentro do sandbox (por exemplo, falta de credenciais ou acesso externo). Sempre verifique se o objetivo da tarefa foi cumprido executando ou detalhando os testes relevantes (use o comando de testes sugerido quando existir) e relate claramente os resultados. O resumo final e qualquer explicação para PRs devem ser escritos em português. Para integrações com APIs externas, busque e cite a documentação oficial usando a tool http_get antes de implementar.

Em toda mensagem de assistant, inclua obrigatoriamente duas frases objetivas com os prefixos exatos abaixo:
- "Objetivo da interação:" descrevendo, em uma frase, o que você está tentando fazer neste turno.
- "Conclusão da interação:" descrevendo, em uma frase, o resultado/conclusão do turno (ou conclusão parcial quando ainda houver tool call pendente).
Essas frases são auditadas e persistidas, então nunca omita esses prefixos.

Checklist inicial obrigatório de auditoria do runner (ambiente OK):
${checklist}

Se a tarefa envolver criação ou alteração de migrations Liquibase, consulte docs/database/liquibase-mysql57.md e siga estas regras:
- Gere arquivos YAML com raiz 'databaseChangeLog' e inclua-os em apps/backend/src/main/resources/db/changelog/changelog-master.yaml quando necessário.
- Defina 'id' e 'author' consistentes, utilize preConditions com dbms (onFail: MARK_RAN) e marque cada bloco SQL com dbms: mysql.
- O alvo padrão é MySQL 5.7: evite recursos não suportados (CTE/'WITH', window functions, CHECK constraints) e, quando precisar de workarounds, descreva-os.
- Prefira splitStatements: true, stripComments: true, ENGINE=InnoDB e valide o SQL mentalmente como se fosse executado via 'liquibase updateSQL' antes de finalizar.
- Use os exemplos existentes em db/changelog/changeset-001-create-users.yaml como referência para formatação, nomenclatura e estruturas adicionais.

Siga obrigatoriamente as etapas fixas de progresso da investigação, nesta ordem: reproduzir -> localizar causa -> aplicar correção -> validar -> encerrar.
Antes de sugerir ou aplicar qualquer correção para um erro/problema, responda explicitamente: "Por que esse erro aconteceu?". Use evidências do código, logs, dados ou comportamento reproduzido para sustentar a resposta; não confunda sintoma (o que quebrou) com causa (decisão, fluxo, contrato, estado ou lacuna que permitiu quebrar).
Na etapa LOCALIZAR_CAUSA, vá fundo: formule e descarte hipóteses, rastreie a cadeia causal até o ponto onde o comportamento incorreto nasce, identifique por que as proteções existentes não impediram o problema e registre a causa raiz antes de entrar em APLICAR_CORRECAO. Se a evidência não for suficiente, declare a causa provável, o nível de confiança e qual evidência faltou.
O resumo final deve conter uma seção "Causa raiz" com: (1) causa direta, (2) por que ela surgiu, (3) por que não foi detectada antes, e (4) como a correção evita recorrência. Mesmo quando a tarefa pedir apenas proposta/diagnóstico sem alterar código, inclua essa seção.
Regra obrigatória de estagnação em LOCALIZAR_CAUSA: se ficar N ciclos sem nova evidência, registre o bloqueio e então escolha uma nova hipótese com próximo comando diferente ou encerre com diagnóstico + próximos passos.
${profileInstruction}`,
          },
        ],
      },
      {
        type: 'message',
        id: this.sanitizeId('msg_user'),
        role: 'user',
        content: userContent as any,
      },
    ];

    this.resetLayeredContext(job);
    const rootSystemEntry = messages[0] as { id?: string } | undefined;
    const rootUserEntry = messages[1] as { id?: string } | undefined;
    const rootSystemId = typeof rootSystemEntry?.id === 'string' ? rootSystemEntry.id : undefined;
    const rootUserId = typeof rootUserEntry?.id === 'string' ? rootUserEntry.id : undefined;

    let summary = '';
    let turnCount = 0;
    this.log(job, 'loop do modelo iniciado; aguardando chamadas de ferramenta');

    while (true) {
      this.ensureNotCancelled(job);
      turnCount++;
      this.enforceEcoThreeGuardrails(job, turnCount);
      this.applyEcoPreSamplingCompaction(job, messages);
      this.runPromptGarbageCollector(job, messages, rootSystemId, rootUserId);
      const layeredMessages = this.buildLayeredContext(job, messages, rootSystemId, rootUserId);
      this.log(
        job,
        `enviando mensagens para o modelo (historico=${messages.length}, prompt=${layeredMessages.length}, tools=${tools.length})`,
      );
      this.ensureNotCancelled(job);
      const outboundInteraction = this.recordInteraction(
        job,
        'OUTBOUND',
        this.formatMessagesForRecording(layeredMessages),
      );
      const promptCacheKey = this.buildPromptCacheKey(job, model);
      const openAIRequest = {
        model,
        input: layeredMessages,
        tools,
        ...(this.promptCacheRetention ? { prompt_cache_retention: this.promptCacheRetention } : {}),
        ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
      };
      logOpenAIExchange('outbound', 'responses.create', openAIRequest);
      let response: Awaited<ReturnType<OpenAI['responses']['create']>>;
      try {
        response = await openai.responses.create(openAIRequest as any);
        logOpenAIExchange('inbound', 'responses.create', response);
      } catch (error) {
        logOpenAIExchange('error', 'responses.create', {
          name: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      this.log(
        job,
        `resposta do modelo recebida (responseId=${response.id ?? 'n/d'}, output_items=${(response.output ?? []).length})`,
      );

      const usageMetrics = this.addUsageMetrics(job, (response as any).usage);
      this.enforceEcoThreeGuardrails(job, turnCount);

      const output = response.output ?? [];
      const normalizedOutput: ResponseItem[] = output.map((item, index) => {
        if (item.type === 'function_call') {
          const callId = this.extractCallId(item, index);
          const messageId = this.sanitizeId(item.id ?? callId);
          return { ...item, id: messageId, call_id: callId } as ResponseItem;
        }
        return item as ResponseItem;
      });
      const assistantMessage = normalizedOutput.find((item) => item.type === 'message') as ResponseOutputMessage | undefined;
      const toolCalls = normalizedOutput.filter((item) => item.type === 'function_call') as ResponseFunctionToolCallItem[];

      const inboundInteraction = this.recordInteraction(
        job,
        'INBOUND',
        this.formatMessagesForRecording(normalizedOutput),
      );

      if (usageMetrics?.promptTokens !== undefined) {
        outboundInteraction.tokenCount = usageMetrics.promptTokens;
      }
      if (usageMetrics?.completionTokens !== undefined) {
        inboundInteraction.tokenCount = usageMetrics.completionTokens;
      }

      const toolCallDetails =
        toolCalls
          .map((call, idx) => {
            const callId = call.call_id ?? this.extractCallId(call, idx);
            return `${call.name ?? 'sem_nome'}(callId=${callId}, id=${call.id ?? 'n/d'})`;
          })
          .join(', ') || 'nenhum';
      const assistantTextPreview = this.truncate(this.extractOutputText(assistantMessage?.content) ?? '', 240);
      this.log(
        job,
        `modelo retornou ${toolCalls.length} chamadas de ferramenta e mensagem=${Boolean(
          assistantMessage,
        )} (toolCalls=[${toolCallDetails}], textPreview="${assistantTextPreview}")`,
      );

      const text = this.extractOutputText(assistantMessage?.content);
      if (toolCalls.length === 0) {
        summary = text ?? summary;
        if (text) {
          this.appendSummaryLine(job, `Resumo do modelo: ${this.truncate(text, 240)}`);
        }
        if (assistantMessage) {
          messages.push(assistantMessage);
        }
        this.advanceInvestigationStage(job, 'ENCERRAR', 'modelo concluiu sem novas tool calls');
        this.log(job, `resumo final do modelo: "${this.truncate(summary, 240)}"`);
        this.log(job, 'modelo concluiu sem novas tool calls');
        return summary;
      }

      messages.push(...normalizedOutput);

      const toolMessages: ResponseFunctionToolCallOutputItem[] = [];
      const imageMessages: ResponseItem[] = [];
      for (const [index, call] of toolCalls.entries()) {
        this.ensureNotCancelled(job);
        const parsedArgs = this.parseArguments(call.arguments);
        const callId = call.call_id ?? this.extractCallId(call, index);
        const outputId = this.normalizeFunctionCallOutputId(callId, `call_${index}`);
        const toolCall: ToolCall = {
          id: callId,
          name: call.name ?? '',
          arguments: parsedArgs ?? {},
        };
        const toolSignature = this.buildToolSignature(toolCall);
        const stagnationBlock = this.evaluateHypothesisStagnationBlock(job, toolCall, toolSignature);
        if (stagnationBlock) {
          this.log(job, stagnationBlock.logMessage);
          this.captureContextFromTool(job, toolCall, stagnationBlock.payload, { blocked: true });
          const blockOutput = this.prepareToolOutput(stagnationBlock.payload, job);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: blockOutput,
            type: 'function_call_output',
          });
          continue;
        }
        const loopBlock = this.evaluateEcoTwoLoopBlock(job, toolSignature, toolCall.name ?? '');
        if (loopBlock) {
          this.log(job, loopBlock.logMessage);
          this.captureContextFromTool(job, toolCall, loopBlock.payload, { blocked: true });
          const blockOutput = this.prepareToolOutput(loopBlock.payload, job);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: blockOutput,
            type: 'function_call_output',
          });
          continue;
        }
        const repeatedErrorBlock = this.evaluateRepeatedToolErrorBlock(job, toolSignature, toolCall.name ?? '');
        if (repeatedErrorBlock) {
          this.log(job, repeatedErrorBlock.logMessage);
          this.captureContextFromTool(job, toolCall, repeatedErrorBlock.payload, { blocked: true });
          const blockOutput = this.prepareToolOutput(repeatedErrorBlock.payload, job);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: blockOutput,
            type: 'function_call_output',
          });
          continue;
        }
        this.log(
          job,
          `executando tool ${toolCall.name} (callId=${callId}, args=${JSON.stringify(toolCall.arguments)})`,
        );
        this.updateInvestigationStageFromTool(job, toolCall);
        try {
          const result = await this.dispatchTool(toolCall, repoPath, job);
          this.logJson(job, `resultado da tool ${toolCall.name} (callId=${callId})`, result);
          this.captureContextFromTool(job, toolCall, result);
          const preparedOutput = this.prepareToolOutput(result, job);
          const imageMessage = this.buildImageToolMessage(result);
          if (imageMessage) {
            imageMessages.push(imageMessage);
          }
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: preparedOutput,
            type: 'function_call_output',
          });
          this.recordEcoTwoLoopAttempt(job, toolSignature, toolCall.name ?? '', preparedOutput);
          this.recordObjectiveAttempt(job, toolSignature, preparedOutput);
          this.recordLocalizarCausaEvidence(job, preparedOutput);
          this.resetRepeatedErrorState(job, toolSignature);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(job, `erro ao executar tool ${toolCall.name}: ${message}`);
          const errorPayload = { error: message };
          this.captureContextFromTool(job, toolCall, errorPayload, { error: true });
          const preparedOutput = this.prepareToolOutput(errorPayload, job);
          toolMessages.push({
            id: outputId,
            call_id: callId,
            output: preparedOutput,
            type: 'function_call_output',
          });
          this.recordEcoTwoLoopAttempt(job, toolSignature, toolCall.name ?? '', preparedOutput);
          this.recordObjectiveAttempt(job, toolSignature, preparedOutput);
          this.recordLocalizarCausaEvidence(job, preparedOutput);
          this.recordRepeatedErrorAttempt(job, toolSignature, message);
        }
      }

      messages.push(...toolMessages, ...imageMessages);
      this.enforceEcoAutoCompaction(job, messages);
    }
  }

  private formatMessagesForRecording(items: ResponseItem[]): string {
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }
    return items
      .map((item, index) => this.formatSingleResponseItem(item, index))
      .join("\\n\\n---\\n\\n");
  }

  private formatSingleResponseItem(item: ResponseItem, index: number): string {
    switch (item.type) {
      case 'message': {
        const message = item as ResponseOutputMessage;
        const role = message.role ?? 'assistant';
        const text = this.collectMessageTexts(message.content);
        return `[${role}]\n${text}`;
      }
      case 'function_call': {
        const call = item as ResponseFunctionToolCallItem;
        const args =
          typeof call.arguments === 'string'
            ? call.arguments
            : this.safeStringify(call.arguments ?? {});
        const callId = call.call_id ?? call.id ?? `call_${index}`;
        const name = call.name ?? 'sem_nome';
        return `[tool_call:${name}] id=${callId}\n${args}`;
      }
      case 'function_call_output': {
        const output = item as ResponseFunctionToolCallOutputItem;
        const callId = output.call_id ?? `call_${index}`;
        const rendered =
          typeof output.output === 'string' ? output.output : this.safeStringify(output.output ?? {});
        return `[tool_result:${callId}]\n${rendered}`;
      }
      default: {
        if (this.isReasoningItem(item)) {
          const reasoning = item as unknown as ResponseReasoningItem;
          const reasoningText = Array.isArray(reasoning.summary)
            ? reasoning.summary.map((entry) => entry.text).join('\n')
            : '';
          return `[reasoning]\n${reasoningText}`;
        }
        return `[${item.type}] ${this.safeStringify(item)}`;
      }
    }
  }

  private collectMessageTexts(content: ResponseOutputMessage['content'] | undefined): string {
    if (!Array.isArray(content) || content.length === 0) {
      return '';
    }
    const segments: string[] = [];
    for (const entry of content) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      if ('text' in entry && typeof (entry as any).text === 'string') {
        const value = ((entry as any).text as string).trim();
        if (value) {
          segments.push(value);
        }
      } else if ('content' in entry && typeof (entry as any).content === 'string') {
        const value = ((entry as any).content as string).trim();
        if (value) {
          segments.push(value);
        }
      }
    }
    if (segments.length === 0) {
      return this.safeStringify(content);
    }
    return segments.join("\\n");
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => [key, this.stableStringify(val)] as const)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${val}`);
    return `{${entries.join(',')}}`;
  }

  private buildToolSignature(call: ToolCall): string {
    const argsKey = this.stableStringify(call.arguments ?? {});
    const toolName = call.name?.trim() || 'desconhecida';
    return `${toolName}::${argsKey}`;
  }

  private hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private isEcoTwoLoopGuardedTool(toolName?: string): boolean {
    if (!toolName) {
      return false;
    }
    return ECO_TWO_LOOP_GUARDED_TOOLS.has(toolName);
  }

  private getEcoTwoLoopState(job: SandboxJob): EcoTwoLoopState {
    let state = this.ecoTwoLoopStates.get(job);
    if (!state) {
      state = { attempts: [], blockedCount: 0 };
      this.ecoTwoLoopStates.set(job, state);
    }
    return state;
  }

  private evaluateEcoTwoLoopBlock(
    job: SandboxJob,
    signature: string,
    toolName: string,
  ): EcoTwoLoopBlockResult | undefined {
    if (!this.isEcoTwo(job) || !this.isEcoTwoLoopGuardedTool(toolName)) {
      return undefined;
    }
    if (this.ecoTwoMaxIdenticalToolAttempts <= 1) {
      return undefined;
    }
    const state = this.getEcoTwoLoopState(job);
    const recent = state.attempts.slice(-this.ecoTwoMaxIdenticalToolAttempts);
    if (recent.length < this.ecoTwoMaxIdenticalToolAttempts) {
      return undefined;
    }
    if (!recent.every((attempt) => attempt.signature === signature)) {
      return undefined;
    }
    const uniqueOutputs = new Set(recent.map((attempt) => attempt.outputHash));
    if (uniqueOutputs.size !== 1) {
      return undefined;
    }
    state.blockedSignature = signature;
    state.blockedCount += 1;
    const attempts = this.ecoTwoMaxIdenticalToolAttempts;
    return {
      payload: {
        error: 'Modo ECO-2 bloqueou a execução repetida desta tool.',
        tool: toolName || 'desconhecida',
        attemptsConsidered: attempts,
        guidance:
          'Revise o plano, edite os arquivos necessários ou explique o que mudou antes de repetir o mesmo comando.',
      },
      logMessage: `Modo ECO-2: loop bloqueado para ${toolName || 'tool'} após ${attempts} respostas idênticas.`,
    };
  }

  private recordEcoTwoLoopAttempt(
    job: SandboxJob,
    signature: string,
    toolName: string,
    preparedOutput: string,
  ): void {
    if (!this.isEcoTwo(job) || !this.isEcoTwoLoopGuardedTool(toolName)) {
      return;
    }
    const state = this.getEcoTwoLoopState(job);
    const attempt: EcoTwoLoopAttempt = {
      signature,
      toolName,
      outputHash: this.hashString(preparedOutput),
      timestamp: Date.now(),
    };
    state.attempts.push(attempt);
    if (state.attempts.length > this.ecoTwoLoopHistorySize) {
      state.attempts.splice(0, state.attempts.length - this.ecoTwoLoopHistorySize);
    }
  }

  private resetEcoTwoLoopAttempts(job: SandboxJob, reason?: string): void {
    if (!this.isEcoTwo(job)) {
      return;
    }
    const state = this.ecoTwoLoopStates.get(job);
    if (!state || state.attempts.length === 0) {
      return;
    }
    state.attempts.length = 0;
    state.blockedSignature = undefined;
    if (reason) {
      this.log(job, `Modo ECO-2: histórico de tentativas idênticas redefinido (${reason}).`);
    }
  }

  private recordInteraction(
    job: SandboxJob,
    direction: SandboxInteraction['direction'],
    content: string,
    tokenCount?: number,
  ): SandboxInteraction {
    const createdAt = new Date().toISOString();
    const currentSequence = Number.isFinite(job.interactionSequence) ? job.interactionSequence + 1 : 1;
    job.interactionSequence = currentSequence;
    job.interactionCount = currentSequence;
    const sequence = currentSequence;
    const identifier = `${job.jobId}-${String(sequence).padStart(4, '0')}-${direction.toLowerCase()}`;
    const interaction: SandboxInteraction = {
      id: identifier,
      direction,
      content: this.decorateInteractionContent(direction, content),
      tokenCount,
      createdAt,
      sequence,
    };
    job.interactions.push(interaction);
    return interaction;
  }

  private decorateInteractionContent(direction: SandboxInteraction['direction'], content: string): string {
    const renderedContent = typeof content === 'string' ? content : this.safeStringify(content);
    const metadata = direction === 'INBOUND'
      ? this.extractAssistantInteractionMetadata(renderedContent)
      : undefined;

    if (!metadata && direction === 'OUTBOUND') {
      return this.safeStringify({
        format: 'interaction-audit-v1',
        transcript: renderedContent,
      });
    }

    return this.safeStringify({
      format: 'interaction-audit-v1',
      transcript: renderedContent,
      objective: metadata?.objective,
      conclusion: metadata?.conclusion,
    });
  }

  private extractAssistantInteractionMetadata(content: string): { objective?: string; conclusion?: string } | undefined {
    const objective = this.extractInteractionSentence(content, 'Objetivo da interação');
    const conclusion = this.extractInteractionSentence(content, 'Conclusão da interação');
    if (!objective && !conclusion) {
      return undefined;
    }
    return {
      objective,
      conclusion,
    };
  }

  private extractInteractionSentence(content: string, label: string): string | undefined {
    if (!content || !label) {
      return undefined;
    }
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedLabel}:\\s*(.+)`, 'gi');
    const matches = Array.from(content.matchAll(pattern));
    const match = matches.length > 0 ? matches[matches.length - 1] : undefined;
    if (!match || match.length < 2) {
      return undefined;
    }
    const line = match[1]?.split('\n')[0]?.trim();
    return line ? this.truncate(line, 400) : undefined;
  }

  private resetLayeredContext(job: SandboxJob): void {
    this.layeredContexts.set(job, {
      summaryLines: [],
      workingSet: [],
      turnsSinceCompaction: 0,
      evidenceCache: new Map(),
      recentToolCalls: [],
      cacheStats: { hitCount: 0, missCount: 0, redundantAvoided: 0 },
      shellCommandCache: new Map(),
      shellMetrics: {
        totalCommands: 0,
        duplicateCommands: 0,
        uniqueBySignature: new Map(),
        alertThreshold: this.shellDuplicateAlertThreshold,
      },
      turnCounter: 0,
    });
  }

  private getLayeredContextState(job: SandboxJob): LayeredContextState {
    let state = this.layeredContexts.get(job);
    if (!state) {
      state = {
        summaryLines: [],
        workingSet: [],
        turnsSinceCompaction: 0,
        evidenceCache: new Map(),
        recentToolCalls: [],
        cacheStats: { hitCount: 0, missCount: 0, redundantAvoided: 0 },
        shellCommandCache: new Map(),
        shellMetrics: {
          totalCommands: 0,
          duplicateCommands: 0,
          uniqueBySignature: new Map(),
          alertThreshold: this.shellDuplicateAlertThreshold,
        },
        turnCounter: 0,
      };
      this.layeredContexts.set(job, state);
    }
    return state;
  }

  private registerContextTurn(job: SandboxJob): void {
    const state = this.getLayeredContextState(job);
    state.turnCounter += 1;
    state.turnsSinceCompaction += 1;
    if (state.turnsSinceCompaction < this.contextSummaryCompactionInterval) {
      return;
    }
    if (state.summaryLines.length <= 1) {
      state.turnsSinceCompaction = 0;
      return;
    }
    const compacted = this.compactSummaryLines(state.summaryLines);
    state.summaryLines = compacted;
    state.turnsSinceCompaction = 0;
    this.log(job, `contexto: resumo técnico compactado após ${this.contextSummaryCompactionInterval} interações.`);
  }

  private compactSummaryLines(lines: string[]): string[] {
    const kept = lines.slice(-Math.max(1, Math.floor(this.contextSummaryLineLimit / 2)));
    const confirmedFacts: string[] = [];
    const refutedHypotheses: string[] = [];
    const pendingItems: string[] = [];
    for (const line of lines) {
      const normalized = line.toLowerCase();
      if (/(erro|falha|bloqueio|refutad|hipótese estagnada)/.test(normalized)) {
        refutedHypotheses.push(line);
      } else if (/(pendente|próximo|proxima|validar|todo)/.test(normalized)) {
        pendingItems.push(line);
      } else {
        confirmedFacts.push(line);
      }
    }
    const compacted = [
      `Resumo técnico compactado (${new Date().toISOString()}):`,
      `- Fatos confirmados: ${this.joinCompactBucket(confirmedFacts)}`,
      `- Hipóteses refutadas: ${this.joinCompactBucket(refutedHypotheses)}`,
      `- Pendências: ${this.joinCompactBucket(pendingItems)}`,
      ...kept,
    ];
    return compacted.slice(-this.contextSummaryLineLimit);
  }

  private joinCompactBucket(lines: string[]): string {
    if (!lines.length) {
      return 'nenhum registro';
    }
    return lines.slice(-3).map((entry) => this.truncate(entry, 140)).join(' | ');
  }

  private appendSummaryLine(job: SandboxJob, line?: string): void {
    if (!line) {
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const state = this.getLayeredContextState(job);
    state.summaryLines.push(trimmed);
    while (state.summaryLines.length > this.contextSummaryLineLimit) {
      state.summaryLines.shift();
    }
  }

  private upsertWorkingSetItem(job: SandboxJob, item: ContextWorkingSetItem): void {
    if (!item || !item.key) {
      return;
    }
    const state = this.getLayeredContextState(job);
    const existingIndex = state.workingSet.findIndex((entry) => entry.key === item.key);
    const cappedContent = this.truncate(item.content ?? '', this.contextWorkingSetItemCharLimit);
    if (existingIndex >= 0) {
      state.workingSet[existingIndex] = { ...item, content: cappedContent };
    } else {
      state.workingSet.push({ ...item, content: cappedContent });
    }
    while (state.workingSet.length > this.contextWorkingSetLimit) {
      state.workingSet.shift();
    }
  }

  private buildObjectiveLayer(job: SandboxJob): ResponseItem | undefined {
    const lines = [
      'Objetivo atual (resumo fixo):',
      `- Job: ${job.jobId}`,
      `- Branch: ${job.branch}`,
      job.profile ? `- Perfil: ${job.profile}` : undefined,
      job.model ? `- Modelo: ${job.model}` : undefined,
      job.testCommand ? `- Testes esperados: ${job.testCommand}` : undefined,
      job.taskDescription ? `- Tarefa: ${this.truncate(job.taskDescription, 500)}` : undefined,
      this.buildInvestigationStatusLine(job),
    ].filter((entry): entry is string => Boolean(entry));
    if (lines.length === 0) {
      return undefined;
    }
    return {
      type: 'message',
      id: this.sanitizeId('msg_objective'),
      role: 'system',
      content: [{ type: 'input_text', text: lines.join('\n') }],
    } as ResponseItem;
  }

  private getInvestigationState(job: SandboxJob): InvestigationProgressState {
    let state = this.investigationStates.get(job);
    if (!state) {
      state = {
        stage: 'REPRODUZIR',
        completedStages: [],
        objectiveAttempts: new Map(),
        blockedObjectives: [],
        localizarCausaNoEvidenceCycles: 0,
        localizarCausaLastEvidenceHash: undefined,
        localizarCausaLastEvidenceAt: undefined,
      };
      this.investigationStates.set(job, state);
      this.log(job, `progresso inicial da investigação: etapa ${state.stage}`);
    }
    return state;
  }

  private buildInvestigationStatusLine(job: SandboxJob): string {
    const state = this.getInvestigationState(job);
    const completed = state.completedStages.length
      ? state.completedStages.join(' -> ')
      : 'nenhuma';
    return `- Progresso obrigatório: etapa atual ${state.stage}; concluídas: ${completed}; limite de estagnação por hipótese: ${this.stagnationMaxAttempts}`;
  }

  private advanceInvestigationStage(job: SandboxJob, nextStage: InvestigationStage, reason: string): void {
    const state = this.getInvestigationState(job);
    if (state.stage === nextStage) {
      return;
    }
    const currentIndex = SandboxJobProcessor.INVESTIGATION_STAGES.indexOf(state.stage);
    const nextIndex = SandboxJobProcessor.INVESTIGATION_STAGES.indexOf(nextStage);
    if (nextIndex < 0 || currentIndex < 0 || nextIndex <= currentIndex) {
      return;
    }
    const completed = SandboxJobProcessor.INVESTIGATION_STAGES.slice(currentIndex, nextIndex);
    for (const stage of completed) {
      if (!state.completedStages.includes(stage)) {
        state.completedStages.push(stage);
      }
    }
    state.stage = nextStage;
    this.appendSummaryLine(job, `Etapa atual da investigação: ${nextStage}. Motivo: ${reason}.`);
    this.log(job, `progresso da investigação atualizado para ${nextStage} (${reason})`);
    state.objectiveAttempts.clear();
    state.localizarCausaNoEvidenceCycles = 0;
    state.localizarCausaLastEvidenceHash = undefined;
    state.localizarCausaLastEvidenceAt = undefined;
  }

  private buildObjectiveKey(stage: InvestigationStage, signature: string): string {
    return `${stage}::${signature}`;
  }

  private evaluateHypothesisStagnationBlock(
    job: SandboxJob,
    call: ToolCall,
    signature: string,
  ): EcoTwoLoopBlockResult | undefined {
    const state = this.getInvestigationState(job);
    this.maybeResetLocalizarCausaStagnation(job);
    if (
      state.stage === 'LOCALIZAR_CAUSA'
      && state.localizarCausaNoEvidenceCycles >= this.stagnationMaxAttempts
    ) {
      const logMessage = `bloqueio por falta de nova evidência: etapa LOCALIZAR_CAUSA sem evolução após ${state.localizarCausaNoEvidenceCycles} ciclos.`;
      this.appendSummaryLine(
        job,
        `Bloqueio registrado: etapa LOCALIZAR_CAUSA ficou ${state.localizarCausaNoEvidenceCycles} ciclos sem nova evidência. Escolha nova hipótese ou encerre com diagnóstico e próximos passos.`,
      );
      return {
        payload: {
          error: 'LOCALIZAR_CAUSA sem nova evidência.',
          stage: state.stage,
          attempts: state.localizarCausaNoEvidenceCycles,
          requiredAction:
            'Etapa LOCALIZAR_CAUSA estagnada: escolha nova hipótese com próximo comando diferente ou encerre com diagnóstico e próximos passos.',
        },
        logMessage,
      };
    }
    const objectiveKey = this.buildObjectiveKey(state.stage, signature);
    const objectiveState = state.objectiveAttempts.get(objectiveKey);
    if (!objectiveState) {
      return undefined;
    }
    if (this.shouldResetObjectiveState(objectiveState)) {
      state.objectiveAttempts.delete(objectiveKey);
      return undefined;
    }
    const effectiveLimit = this.resolveStagnationLimit(call);
    if (objectiveState.attempts < effectiveLimit) {
      return undefined;
    }
    if (objectiveState.blocked) {
      return undefined;
    }
    objectiveState.blocked = true;
    state.blockedObjectives.push(objectiveKey);
    const toolName = call.name ?? '';
    const logMessage = `bloqueio de hipótese: objetivo ${objectiveKey} sem evolução após ${objectiveState.attempts} tentativas.`;
    this.appendSummaryLine(
      job,
      `Bloqueio registrado: hipótese '${toolName || 'desconhecida'}' na etapa ${state.stage} ficou sem evolução após ${objectiveState.attempts} ciclos. Escolha nova hipótese ou encerre com diagnóstico parcial e próximos passos.`,
    );
    return {
      payload: {
        error: 'Hipótese estagnada sem evolução.',
        stage: state.stage,
        objective: objectiveKey,
        attempts: objectiveState.attempts,
        requiredAction:
          'Registre o bloqueio e siga uma das opções obrigatórias: (1) nova hipótese com próximo comando diferente; (2) encerrar com diagnóstico parcial e próximos passos.',
      },
      logMessage,
    };
  }

  private resolveStagnationLimit(call: ToolCall): number {
    if (!call?.name) {
      return this.stagnationMaxAttempts;
    }
    if (call.name === 'read_file') {
      return this.inspectionStagnationMaxAttempts;
    }
    if (call.name === 'run_shell') {
      const executable = this.extractRunShellExecutable(call);
      if (this.isInspectionShellCommand(executable)) {
        return this.inspectionStagnationMaxAttempts;
      }
    }
    return this.stagnationMaxAttempts;
  }

  private extractRunShellExecutable(call: ToolCall): string | undefined {
    const args = (call.arguments ?? {}) as { command?: unknown };
    const commandArg = args.command;
    if (!Array.isArray(commandArg) || commandArg.length === 0) {
      return undefined;
    }
    const firstToken = String(commandArg[0]).trim();
    if (!firstToken) {
      return undefined;
    }
    return path.basename(firstToken);
  }

  private isInspectionShellCommand(executable?: string): boolean {
    if (!executable) {
      return false;
    }
    return INSPECTION_SHELL_EXECUTABLES.has(executable.toLowerCase());
  }

  private maybeResetLocalizarCausaStagnation(job: SandboxJob): void {
    const state = this.getInvestigationState(job);
    if (!state.localizarCausaLastEvidenceAt) {
      return;
    }
    if (Date.now() - state.localizarCausaLastEvidenceAt < this.stagnationResetMs) {
      return;
    }
    state.localizarCausaLastEvidenceAt = undefined;
    state.localizarCausaLastEvidenceHash = undefined;
    state.localizarCausaNoEvidenceCycles = 0;
  }

  private shouldResetObjectiveState(objectiveState: ObjectiveAttemptState): boolean {
    if (!objectiveState.updatedAt) {
      return false;
    }
    return Date.now() - objectiveState.updatedAt >= this.stagnationResetMs;
  }

  private recordObjectiveAttempt(job: SandboxJob, signature: string, toolOutput: string): void {
    const state = this.getInvestigationState(job);
    const objectiveKey = this.buildObjectiveKey(state.stage, signature);
    const outputHash = this.hashString(toolOutput);
    const previous = state.objectiveAttempts.get(objectiveKey);
    const attempts = previous && previous.lastOutputHash === outputHash ? previous.attempts + 1 : 1;
    state.objectiveAttempts.set(objectiveKey, {
      attempts,
      lastOutputHash: outputHash,
      blocked: false,
      updatedAt: Date.now(),
    });
  }

  private recordLocalizarCausaEvidence(job: SandboxJob, toolOutput: string): void {
    const state = this.getInvestigationState(job);
    if (state.stage !== 'LOCALIZAR_CAUSA') {
      return;
    }
    const outputHash = this.hashString(toolOutput);
    state.localizarCausaLastEvidenceAt = Date.now();
    if (!state.localizarCausaLastEvidenceHash) {
      state.localizarCausaLastEvidenceHash = outputHash;
      state.localizarCausaNoEvidenceCycles = 1;
      return;
    }
    if (state.localizarCausaLastEvidenceHash === outputHash) {
      state.localizarCausaNoEvidenceCycles += 1;
      return;
    }
    state.localizarCausaLastEvidenceHash = outputHash;
    state.localizarCausaNoEvidenceCycles = 0;
  }

  private updateInvestigationStageFromTool(job: SandboxJob, toolCall: ToolCall): void {
    const toolName = toolCall.name ?? '';
    const command = String(toolCall.arguments?.command ?? '').toLowerCase();
    if (toolName === 'write_file') {
      this.advanceInvestigationStage(job, 'APLICAR_CORRECAO', 'alteração em arquivo detectada');
      return;
    }
    if (toolName === 'read_file' || toolName === 'db_query' || (toolName === 'run_shell' && command.includes('rg '))) {
      this.advanceInvestigationStage(job, 'LOCALIZAR_CAUSA', `análise via ${toolName}`);
      return;
    }
    if (toolName === 'run_shell' && /(test|pytest|jest|vitest|mvn test|gradle test|npm test|pnpm test|yarn test)/.test(command)) {
      this.advanceInvestigationStage(job, 'VALIDAR', 'execução de comando de validação');
    }
  }

  private buildSummaryLayer(job: SandboxJob): ResponseItem | undefined {
    const state = this.getLayeredContextState(job);
    if (!state.summaryLines.length) {
      return undefined;
    }
    const header = `Resumo rolante (máx. ${this.contextSummaryLineLimit} linhas, mais recente por último):`;
    const text = [header, ...state.summaryLines].join('\n');
    return {
      type: 'message',
      id: this.sanitizeId('msg_summary'),
      role: 'system',
      content: [{ type: 'input_text', text }],
    } as ResponseItem;
  }

  private buildWorkingSetLayer(job: SandboxJob): ResponseItem | undefined {
    const state = this.getLayeredContextState(job);
    if (!state.workingSet.length) {
      return undefined;
    }
    const entries = state.workingSet.map((entry, index) => {
      const title = entry.title ?? `Item ${index + 1}`;
      return `${index + 1}. ${title}
${entry.content}`;
    });
    const text = [`Working set ativo (máx. ${this.contextWorkingSetLimit} itens):`, ...entries].join('\n\n');
    return {
      type: 'message',
      id: this.sanitizeId('msg_working_set'),
      role: 'system',
      content: [{ type: 'input_text', text }],
    } as ResponseItem;
  }

  private buildLayeredContext(
    job: SandboxJob,
    history: ResponseItem[],
    rootSystemId?: string,
    rootUserId?: string,
  ): ResponseItem[] {
    this.registerContextTurn(job);
    const layered: ResponseItem[] = [];
    const baseSystem = history.find(
      (item) =>
        item?.type === 'message'
        && (((item as ResponseOutputMessage).role ?? '').toString().toLowerCase() === 'system'),
    );
    if (baseSystem) {
      layered.push(baseSystem);
    }
    const objective = this.buildObjectiveLayer(job);
    if (objective) {
      layered.push(objective);
    }
    const summary = this.buildSummaryLayer(job);
    if (summary) {
      layered.push(summary);
    }
    const workingSet = this.buildWorkingSetLayer(job);
    if (workingSet) {
      layered.push(workingSet);
    }
    const recent = this.collectRecentHistory(history, rootSystemId, rootUserId);
    layered.push(...recent);
    return layered;
  }

  private collectRecentHistory(
    history: ResponseItem[],
    rootSystemId?: string,
    rootUserId?: string,
  ): ResponseItem[] {
    if (!Array.isArray(history) || history.length === 0) {
      return [];
    }
    const selectedIndices = new Set<number>();
    for (let index = history.length - 1; index >= 0 && selectedIndices.size < this.contextRecentMessageLimit; index--) {
      if (this.isProtectedHistoryItem(history[index], rootSystemId, rootUserId)) {
        continue;
      }
      selectedIndices.add(index);
    }

    const addIndex = (idx: number) => {
      if (idx <= 0 || idx >= history.length) {
        return;
      }
      if (this.isProtectedHistoryItem(history[idx], rootSystemId, rootUserId)) {
        return;
      }
      selectedIndices.add(idx);
    };

    for (const index of Array.from(selectedIndices)) {
      const item = history[index];
      if (!item) {
        continue;
      }
      if (item.type === 'function_call_output') {
        const output = item as ResponseFunctionToolCallOutputItem;
        const callIndex = this.findFunctionCallIndex(history, output.call_id);
        if (callIndex >= 0) {
          addIndex(callIndex);
          this.includeAdjacentReasoning(history, callIndex, selectedIndices, rootSystemId, rootUserId);
        }
      } else if (item.type === 'function_call') {
        this.includeAdjacentReasoning(history, index, selectedIndices, rootSystemId, rootUserId);
      } else if (this.isReasoningItem(item)) {
        if (index + 1 < history.length && history[index + 1]?.type === 'function_call') {
          addIndex(index + 1);
        }
      }
    }

    return Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map((idx) => history[idx])
      .filter(Boolean);
  }

  private includeAdjacentReasoning(
    history: ResponseItem[],
    callIndex: number,
    selectedIndices: Set<number>,
    rootSystemId?: string,
    rootUserId?: string,
  ): void {
    let pointer = callIndex - 1;
    while (pointer >= 0 && this.isReasoningItem(history[pointer])) {
      if (!this.isProtectedHistoryItem(history[pointer], rootSystemId, rootUserId)) {
        selectedIndices.add(pointer);
      }
      pointer--;
    }
    pointer = callIndex + 1;
    while (pointer < history.length && this.isReasoningItem(history[pointer])) {
      if (!this.isProtectedHistoryItem(history[pointer], rootSystemId, rootUserId)) {
        selectedIndices.add(pointer);
      }
      pointer++;
    }
  }

  private findFunctionCallIndex(history: ResponseItem[], callId?: string): number {
    if (!Array.isArray(history) || history.length === 0) {
      return -1;
    }
    for (let index = history.length - 1; index >= 0; index--) {
      const item = history[index];
      if (!item || item.type !== 'function_call') {
        continue;
      }
      const call = item as ResponseFunctionToolCallItem;
      if (!callId || call.call_id === callId || call.id === callId) {
        return index;
      }
    }
    return -1;
  }

  private isProtectedHistoryItem(
    item: ResponseItem | undefined,
    rootSystemId?: string,
    rootUserId?: string,
  ): boolean {
    if (!item) {
      return true;
    }
    const identifier = (item as { id?: string }).id;
    if (identifier && rootSystemId && identifier === rootSystemId) {
      return true;
    }
    if (identifier && rootUserId && identifier === rootUserId) {
      return true;
    }
    return false;
  }

  private isReasoningItem(item: ResponseItem | undefined): boolean {
    return Boolean(item && (item as { type?: string }).type === 'reasoning');
  }

  private runPromptGarbageCollector(
    job: SandboxJob,
    messages: ResponseItem[],
    rootSystemId?: string,
    rootUserId?: string,
  ): void {
    if (this.contextPromptGcTokenThreshold <= 0 || !Array.isArray(messages) || messages.length === 0) {
      return;
    }
    let estimate = this.estimateMessagesTokenFootprint(messages);
    if (estimate <= this.contextPromptGcTokenThreshold) {
      return;
    }
    let removed = 0;
    let iterations = 0;
    while (estimate > this.contextPromptGcTargetTokens && iterations < 500) {
      const deleted = this.trimOldestHistoryBlock(messages, rootSystemId, rootUserId);
      if (deleted === 0) {
        break;
      }
      removed += deleted;
      iterations++;
      estimate = this.estimateMessagesTokenFootprint(messages);
    }
    if (removed > 0) {
      this.log(
        job,
        `Context manager removeu ${removed} item(ns) antigos para manter o prompt estimado em ${estimate} tokens`,
      );
    }
  }

  private trimOldestHistoryBlock(
    messages: ResponseItem[],
    rootSystemId?: string,
    rootUserId?: string,
  ): number {
    for (let index = 0; index < messages.length; index++) {
      const item = messages[index];
      if (this.isProtectedHistoryItem(item, rootSystemId, rootUserId)) {
        continue;
      }
      if (!this.isRemovableHistoryItem(item)) {
        continue;
      }
      return this.removeHistoryItemWithDependencies(messages, index);
    }
    return 0;
  }

  private removeHistoryItemWithDependencies(messages: ResponseItem[], index: number): number {
    const item = messages[index];
    if (!item) {
      return 0;
    }
    if (item.type === 'function_call') {
      return this.removeFunctionCallFamily(messages, index);
    }
    if (item.type === 'function_call_output') {
      const output = item as ResponseFunctionToolCallOutputItem;
      const callIndex = this.findFunctionCallIndex(messages, output.call_id);
      if (callIndex >= 0 && callIndex <= index) {
        return this.removeFunctionCallFamily(messages, callIndex);
      }
    }
    if (this.isReasoningItem(item)) {
      if (index + 1 < messages.length && messages[index + 1]?.type === 'function_call') {
        return this.removeFunctionCallFamily(messages, index + 1);
      }
    }
    messages.splice(index, 1);
    return 1;
  }

  private removeFunctionCallFamily(messages: ResponseItem[], callIndex: number): number {
    if (callIndex < 0 || callIndex >= messages.length) {
      return 0;
    }
    let start = callIndex;
    while (start - 1 >= 0 && this.isReasoningItem(messages[start - 1])) {
      start--;
    }
    const call = messages[callIndex] as ResponseFunctionToolCallItem;
    const callId = call.call_id ?? call.id ?? '';
    let end = callIndex;
    for (let idx = callIndex + 1; idx < messages.length; idx++) {
      const candidate = messages[idx];
      if (!candidate) {
        break;
      }
      if (candidate.type === 'function_call_output') {
        const output = candidate as ResponseFunctionToolCallOutputItem;
        if (!callId || output.call_id === callId) {
          end = idx;
          continue;
        }
        break;
      }
      if (this.isReasoningItem(candidate)) {
        end = idx;
        continue;
      }
      break;
    }
    const deleteCount = end - start + 1;
    messages.splice(start, deleteCount);
    return deleteCount;
  }

  private captureContextFromTool(
    job: SandboxJob,
    call: ToolCall,
    result: unknown,
    options?: { blocked?: boolean; error?: boolean },
  ): void {
    const summaryLine = this.buildToolSummaryLine(call, result, options);
    if (summaryLine) {
      this.appendSummaryLine(job, summaryLine);
    }
    const workingItem = this.buildWorkingSetSnapshot(call, result);
    if (workingItem) {
      this.upsertWorkingSetItem(job, workingItem);
    }
    if (call.name === 'write_file') {
      this.registerFirstPatchMetric(job);
    }
  }

  private registerFirstPatchMetric(job: SandboxJob): void {
    const state = this.getLayeredContextState(job);
    if (state.firstPatchAtTurn !== undefined) {
      return;
    }
    state.firstPatchAtTurn = state.turnCounter;
    if (job.startedAt) {
      const startMs = Date.parse(job.startedAt);
      if (Number.isFinite(startMs)) {
        state.firstPatchLatencyMs = Math.max(0, Date.now() - startMs);
      }
    }
  }

  private buildToolSummaryLine(
    call: ToolCall,
    result: unknown,
    options?: { blocked?: boolean; error?: boolean },
  ): string | undefined {
    const name = call.name || 'tool';
    const status = options?.blocked
      ? 'bloqueada'
      : options?.error
        ? 'erro'
        : 'ok';
    const argsPreview = this.truncate(this.safeStringify(call.arguments ?? {}), 160);
    const outcome = this.extractResultPreview(result);
    const parts = [`${name}: ${status}`, `args=${argsPreview}`];
    if (outcome) {
      parts.push(`resultado=${outcome}`);
    }
    return parts.join(' | ');
  }

  private buildWorkingSetSnapshot(call: ToolCall, result: unknown): ContextWorkingSetItem | undefined {
    if (!result || typeof result !== 'object') {
      return undefined;
    }
    const args = (call.arguments ?? {}) as Record<string, unknown>;
    const now = Date.now();
    if (call.name === 'read_file') {
      const pathValue = args.path;
      const pathArg = typeof pathValue === 'string' ? pathValue : undefined;
      const path = (result as any).path ?? pathArg ?? 'arquivo desconhecido';
      const content = typeof (result as any).content === 'string' ? (result as any).content : '';
      if (!content) {
        return undefined;
      }
      return {
        key: `file:${path}`,
        title: `Trecho de ${path}`,
        content,
        source: 'read_file',
        createdAt: now,
      };
    }
    if (call.name === 'write_file') {
      const pathValue = args.path;
      const pathArg = typeof pathValue === 'string' ? pathValue : undefined;
      const path = (result as any).path ?? pathArg ?? 'arquivo desconhecido';
      const content = typeof (result as any).content === 'string' ? (result as any).content : '';
      if (!content) {
        return undefined;
      }
      return {
        key: `file:${path}`,
        title: `Conteúdo atualizado de ${path}`,
        content,
        source: 'write_file',
        createdAt: now,
      };
    }
    if (call.name === 'run_shell') {
      const commandParts = Array.isArray(args.command)
        ? (args.command as unknown[]).map((part) => String(part))
        : undefined;
      const command = commandParts && commandParts.length ? commandParts.join(' ') : 'comando desconhecido';
      const stdout = typeof (result as any).stdout === 'string' ? (result as any).stdout.trim() : '';
      const stderr = typeof (result as any).stderr === 'string' ? (result as any).stderr.trim() : '';
      if (!stdout && !stderr) {
        return undefined;
      }
      const sections: string[] = [];
      if (stdout) {
        sections.push(`stdout:
${stdout}`);
      }
      if (stderr) {
        sections.push(`stderr:
${stderr}`);
      }
      return {
        key: `shell:${this.hashString(command).slice(0, 16)}`,
        title: `Resultado de ${command}`,
        content: sections.join('\n\n'),
        source: 'run_shell',
        createdAt: now,
      };
    }
    if (call.name === 'http_get' || call.name === 'WebSearch' || call.name === 'fetch_image') {
      const urlValue = args.url;
      const urlArg = typeof urlValue === 'string' ? urlValue : undefined;
      const body = typeof (result as any).body === 'string' ? (result as any).body : '';
      if (!body) {
        return undefined;
      }
      const url = urlArg ?? 'URL não informada';
      return {
        key: `http:${this.hashString(url).slice(0, 16)}`,
        title: `Resposta HTTP ${url}`,
        content: body,
        source: call.name ?? 'http_get',
        createdAt: now,
      };
    }
    if (call.name === 'db_query') {
      const rows = Array.isArray((result as any).rows) ? (result as any).rows : [];
      if (!rows.length) {
        return undefined;
      }
      const queryValue = args.query;
      const queryArg = typeof queryValue === 'string' ? queryValue : 'query';
      return {
        key: `db:${this.hashString(queryArg).slice(0, 16)}`,
        title: `Resultado SQL (${rows.length} linhas)`,
        content: JSON.stringify(rows.slice(0, 5)),
        source: 'db_query',
        createdAt: now,
      };
    }
    return undefined;
  }

  private extractResultPreview(result: unknown): string {
    if (typeof result === 'string') {
      return this.truncate(result, 160);
    }
    if (!result || typeof result !== 'object') {
      return '';
    }
    if (typeof (result as any).stdout === 'string') {
      return this.truncate((result as any).stdout, 120);
    }
    if (typeof (result as any).content === 'string') {
      return this.truncate((result as any).content, 120);
    }
    if (typeof (result as any).body === 'string') {
      return this.truncate((result as any).body, 120);
    }
    if (Array.isArray((result as any).rows)) {
      return `rows=${(result as any).rows.length}`;
    }
    return this.truncate(this.safeStringify(result), 160);
  }

  private extractOutputText(content: ResponseOutputMessage['content'] | undefined): string | undefined {
    if (!Array.isArray(content)) {
      return undefined;
    }
    const texts = content
      .filter((item) => item.type === 'output_text')
      .map((item) => (item as ResponseOutputText).text.trim())
      .filter((text) => text.length > 0);

    if (texts.length === 0) {
      return undefined;
    }
    return texts.join('\n').trim();
  }

  private async runConfiguredTestCommand(job: SandboxJob, repoPath: string): Promise<void> {
    const rawCommand = typeof job.testCommand === 'string' ? job.testCommand : '';
    const normalized = rawCommand.trim();
    if (!normalized) {
      this.log(job, 'nenhum testCommand configurado; pulando verificação automática de compilação/testes');
      return;
    }

    const label = this.truncate(normalized.replace(/\s+/g, ' '), 200);
    this.log(job, `executando testCommand configurado para validar compilação/testes: ${label}`);

    const result = await this.handleRunShell(
      { command: ['bash', '-lc', rawCommand], cwd: '.' },
      repoPath,
      job,
    );

    const exitCode = result.exitCode ?? 0;
    const failed = result.timedOut || (result.signal ?? null) !== null || exitCode !== 0;
    if (failed) {
      const failureDetail = result.timedOut
        ? 'tempo limite excedido'
        : result.signal
          ? `processo interrompido com sinal ${result.signal}`
          : `exitCode ${exitCode}`;
      const stderrSnippet = this.truncate((result.stderr ?? '').trim(), 400);
      const stdoutSnippet = this.truncate((result.stdout ?? '').trim(), 400);
      const outputHint = stderrSnippet
        ? `stderr: ${stderrSnippet}`
        : stdoutSnippet
          ? `stdout: ${stdoutSnippet}`
          : 'verifique os logs do sandbox para detalhes.';
      throw new Error(`testCommand "${label}" falhou (${failureDetail}). ${outputHint}`);
    }

    this.log(job, `testCommand finalizado com sucesso (exitCode=${exitCode})`);
  }

  private addUsageMetrics(job: SandboxJob, usage: unknown): TokenUsage | undefined {
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }

    const source = usage as Record<string, unknown>;
    const promptTokens = this.readNumberField(source, ['prompt_tokens', 'input_tokens', 'promptTokens']);
    const completionTokens = this.readNumberField(source, [
      'completion_tokens',
      'output_tokens',
      'completionTokens',
    ]);
    const totalTokens =
      this.readNumberField(source, ['total_tokens', 'totalTokens']) ??
      (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
    const cost = this.readNumberField(source, ['total_cost', 'cost']);

    if (promptTokens !== undefined) {
      job.promptTokens = (job.promptTokens ?? 0) + promptTokens;
    }
    if (completionTokens !== undefined) {
      job.completionTokens = (job.completionTokens ?? 0) + completionTokens;
    }
    if (totalTokens !== undefined) {
      job.totalTokens = (job.totalTokens ?? 0) + totalTokens;
    }
    if (cost !== undefined) {
      job.cost = (job.cost ?? 0) + cost;
    }

    return { promptTokens, completionTokens, totalTokens, cost };
  }

  private readNumberField(source: Record<string, unknown>, candidates: string[]): number | undefined {
    for (const key of candidates) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private parseArguments(raw: unknown): Record<string, unknown> | undefined {
    if (!raw) {
      return undefined;
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (err) {
        return undefined;
      }
    }
    if (typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    return undefined;
  }

  private async dispatchTool(call: ToolCall, repoPath: string, job: SandboxJob): Promise<unknown> {
    this.ensureNotCancelled(job);
    const reuse = this.maybeReuseCachedToolResult(job, call);
    if (reuse.reused) {
      if (reuse.logMessage) {
        this.log(job, reuse.logMessage);
      }
      return reuse.payload;
    }
    if (reuse.logMessage) {
      this.log(job, reuse.logMessage);
    }
    let result: unknown;
    switch (call.name) {
      case 'run_shell':
        result = await this.handleRunShell(call.arguments, repoPath, job);
        break;
      case 'read_file':
        result = await this.handleReadFile(call.arguments, repoPath);
        break;
      case 'read_image':
        result = await this.handleReadImage(call.arguments, repoPath, job);
        break;
      case 'fetch_image':
        result = await this.handleFetchImage(call, job);
        break;
      case 'write_file':
        result = await this.handleWriteFile(call.arguments, repoPath, job);
        break;
      case 'http_get':
      case 'WebSearch':
        result = await this.handleHttpGet(call, job);
        break;
      case 'db_query':
        result = await this.handleDbQuery(call.arguments, job);
        break;
      default:
        result = { error: `Ferramenta desconhecida: ${call.name}` };
    }
    this.storeToolEvidence(job, call, result);
    return result;
  }

  private maybeReuseCachedToolResult(
    job: SandboxJob,
    call: ToolCall,
  ): { reused: boolean; payload: unknown; logMessage?: string } {
    const state = this.getLayeredContextState(job);
    const evidenceKey = this.buildToolEvidenceKey(call);
    const similarityKey = this.buildToolSimilarityKey(call);
    const recentEquivalent = state.recentToolCalls.find((entry) => entry.similarityKey === similarityKey);
    if (recentEquivalent) {
      const existing = state.evidenceCache.get(evidenceKey);
      if (existing !== undefined) {
        state.cacheStats.hitCount += 1;
        state.cacheStats.redundantAvoided += 1;
        this.registerToolCallSnapshot(job, call, evidenceKey, similarityKey);
        return {
          reused: true,
          payload: existing,
          logMessage: `contexto: reutilizando evidência para ${call.name} (equivalente à chamada recente ${recentEquivalent.signature}).`,
        };
      }
      return {
        reused: false,
        payload: undefined,
        logMessage: `contexto: chamada ${call.name} similar detectada, mas sem evidência em cache; executando novamente.`,
      };
    }
    state.cacheStats.missCount += 1;
    return { reused: false, payload: undefined };
  }

  private storeToolEvidence(job: SandboxJob, call: ToolCall, result: unknown): void {
    const state = this.getLayeredContextState(job);
    const evidenceKey = this.buildToolEvidenceKey(call);
    const similarityKey = this.buildToolSimilarityKey(call);
    state.evidenceCache.set(evidenceKey, result);
    if (call.name === 'write_file') {
      const args = (call.arguments ?? {}) as Record<string, unknown>;
      const pathValue = typeof args.path === 'string' ? args.path : '';
      if (pathValue) {
        const readKey = `read_file:${this.hashString(this.safeStringify({ path: pathValue }))}`;
        state.evidenceCache.delete(readKey);
      }
    }
    this.registerToolCallSnapshot(job, call, evidenceKey, similarityKey);
  }

  private registerToolCallSnapshot(job: SandboxJob, call: ToolCall, signature: string, similarityKey: string): void {
    const state = this.getLayeredContextState(job);
    state.recentToolCalls.push({
      signature,
      similarityKey,
      toolName: call.name,
      timestamp: Date.now(),
    });
    if (state.recentToolCalls.length > this.contextSimilarityHistoryLimit) {
      state.recentToolCalls.splice(0, state.recentToolCalls.length - this.contextSimilarityHistoryLimit);
    }
  }

  private buildToolEvidenceKey(call: ToolCall): string {
    const normalizedArgs = this.safeStringify(call.arguments ?? {});
    return `${call.name}:${this.hashString(normalizedArgs)}`;
  }

  private buildToolSimilarityKey(call: ToolCall): string {
    const args = (call.arguments ?? {}) as Record<string, unknown>;
    if (call.name === 'read_file' || call.name === 'write_file' || call.name === 'read_image') {
      return `${call.name}:${String(args.path ?? '')}`;
    }
    if (call.name === 'run_shell') {
      return `${call.name}:${String(args.command ?? '')}:${String(args.cwd ?? '')}`;
    }
    if (call.name === 'http_get' || call.name === 'WebSearch' || call.name === 'fetch_image') {
      return `${call.name}:${String(args.url ?? '')}`;
    }
    if (call.name === 'db_query') {
      return `${call.name}:${String(args.query ?? '')}`;
    }
    return this.buildToolEvidenceKey(call);
  }

  private logContextKpis(job: SandboxJob): void {
    const state = this.layeredContexts.get(job);
    if (!state) {
      return;
    }
    const attempts = state.cacheStats.hitCount + state.cacheStats.missCount;
    const reductionPercent = attempts > 0
      ? ((state.cacheStats.redundantAvoided / attempts) * 100).toFixed(1)
      : '0.0';
    const firstPatchMetric = state.firstPatchLatencyMs !== undefined
      ? `${state.firstPatchLatencyMs}ms (turno=${state.firstPatchAtTurn ?? 'n/d'})`
      : 'n/d';
    const shellMetrics = state.shellMetrics;
    const shellRepetitionRate = shellMetrics.totalCommands > 0
      ? (shellMetrics.duplicateCommands / shellMetrics.totalCommands) * 100
      : 0;
    this.log(
      job,
      `KPI contexto: redução de chamadas redundantes=${reductionPercent}% (evitadas=${state.cacheStats.redundantAvoided}/${attempts}); tempo até primeiro patch=${firstPatchMetric}; run_shell total=${shellMetrics.totalCommands}, únicos=${shellMetrics.uniqueBySignature.size}, repetição=${shellRepetitionRate.toFixed(1)}%.`,
    );
  }

  private normalizeDatabaseConfig(config?: SandboxDatabaseConfig): SandboxDatabaseConfig | undefined {
    if (!config) {
      return undefined;
    }

    const host = typeof config.host === 'string' ? config.host.trim() : '';
    const database = typeof config.database === 'string' ? config.database.trim() : '';
    const user = typeof config.user === 'string' ? config.user.trim() : '';
    const password = typeof config.password === 'string' ? config.password : undefined;
    const port = Number.isFinite(config.port) && config.port ? Math.floor(config.port) : undefined;

    if (!host || !database || !user) {
      return undefined;
    }

    return { host, database, user, password, port } satisfies SandboxDatabaseConfig;
  }

  private loadDatabaseConfig(): SandboxDatabaseConfig | undefined {
    const rawUrl = process.env.DB_URL ?? process.env.DATABASE_URL;
    const user = process.env.DB_USER?.trim();
    const password = process.env.DB_PASS;

    if (!rawUrl || !user || password === undefined) {
      return undefined;
    }

    const sanitizedUrl = rawUrl.startsWith('jdbc:') ? rawUrl.replace(/^jdbc:/, '') : rawUrl;
    let parsed: URL;
    try {
      parsed = new URL(sanitizedUrl);
    } catch (err) {
      console.warn(`Sandbox orchestrator: DB_URL inválida (${err instanceof Error ? err.message : String(err)})`);
      return undefined;
    }

    if (!['mysql:', 'mariadb:'].includes(parsed.protocol)) {
      console.warn(`Sandbox orchestrator: protocolo de banco não suportado: ${parsed.protocol}`);
      return undefined;
    }

    const database = parsed.pathname.replace(/^\//, '').trim();
    if (!database) {
      console.warn('Sandbox orchestrator: DB_URL não contém nome do database');
      return undefined;
    }

    const port = Number(parsed.port) || 3306;
    return this.normalizeDatabaseConfig({
      host: parsed.hostname,
      port: Number.isFinite(port) && port > 0 ? port : 3306,
      user,
      password,
      database,
    });
  }

  private resolveDatabaseConfig(job: SandboxJob): SandboxDatabaseConfig {
    const fromJob = this.normalizeDatabaseConfig(job.database);
    if (fromJob) {
      return fromJob;
    }

    const fromEnv = this.normalizeDatabaseConfig(this.dbConfigFromEnv);
    if (fromEnv) {
      return fromEnv;
    }

    throw new Error('Banco de dados não configurado para este job: configure as credenciais do ambiente solicitado.');
  }

  private getDbPool(job: SandboxJob): Pool {
    const existing = this.dbPools.get(job.jobId);
    if (existing) {
      return existing;
    }

    const config = this.resolveDatabaseConfig(job);
    const pool = mysql.createPool({
      host: config.host,
      port: Number.isFinite(config.port) && config.port ? config.port : 3306,
      user: config.user,
      password: config.password ?? undefined,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 4,
      queueLimit: 0,
    });

    this.dbPools.set(job.jobId, pool);
    return pool;
  }

  private async disposeDbPool(jobId: string): Promise<void> {
    const pool = this.dbPools.get(jobId);
    if (!pool) {
      return;
    }
    this.dbPools.delete(jobId);
    try {
      await pool.end();
    } catch {
      // ignore cleanup errors
    }
  }

  private sanitizeHeaders(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return undefined;
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'string') {
        continue;
      }
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === 'authorization') {
        continue;
      }
      headers[normalizedKey] = value;
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private validateExternalUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('URL inválida');
    }

    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Apenas URLs http(s) são permitidas');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1') {
      throw new Error('Acesso a hosts locais não é permitido');
    }

    const ipVersion = net.isIP(hostname);
    if (ipVersion === 4 || ipVersion === 6) {
      if (this.isPrivateIp(hostname, ipVersion)) {
        throw new Error('Acesso a endereços privados foi bloqueado');
      }
    }

    return parsed;
  }

  private isPrivateIp(host: string, version: 4 | 6): boolean {
    if (version === 6) {
      return host === '::1' || host.startsWith('fd') || host.startsWith('fc');
    }

    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
      return true;
    }

    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  private async handleDbQuery(args: Record<string, unknown>, job: SandboxJob) {
    job.dbQueryCount = (job.dbQueryCount ?? 0) + 1;

    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('query é obrigatória para db_query');
    }
    if (!/^(select|with)\b/i.test(query)) {
      throw new Error('apenas consultas SELECT (incluindo CTEs com WITH) são permitidas em db_query');
    }

    const limitRaw = typeof args.limit === 'number' ? args.limit : Number(args.limit);
    const normalizedLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(Number(limitRaw)) : this.dbMaxRows;
    const maxRows = Math.min(normalizedLimit, this.dbMaxRows);

    const pool = this.getDbPool(job);
    this.log(job, `db_query: executando consulta com limite de ${maxRows} linhas (timeoutMs=${this.dbQueryTimeoutMs})`);
    const started = Date.now();
    let rows: any[] = [];

    try {
      const [result] = await pool.query({ sql: query, rowsAsArray: false, timeout: this.dbQueryTimeoutMs });
      rows = Array.isArray(result) ? result : [];
    } catch (err) {
      if (this.isTimeoutError(err)) {
        job.timeoutCount = (job.timeoutCount ?? 0) + 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`falha ao executar consulta SQL: ${message}`);
    }

    const truncated = rows.length > maxRows;
    const limitedRows = rows.slice(0, maxRows);
    const columns = limitedRows.length > 0 && typeof limitedRows[0] === 'object' && limitedRows[0] !== null
      ? Object.keys(limitedRows[0] as Record<string, unknown>)
      : [];

    return {
      rowCount: limitedRows.length,
      truncated,
      maxRows,
      columns,
      rows: limitedRows,
      elapsedMs: Date.now() - started,
    };
  }

  private async handleHttpGet(call: ToolCall, job: SandboxJob) {
    if (!this.fetchImpl) {
      throw new Error('fetch indisponível para http_get');
    }

    job.httpGetCount = (job.httpGetCount ?? 0) + 1;

    const args = call?.arguments ?? {};
    const urlArg = typeof args.url === 'string' ? args.url : undefined;
    if (!urlArg) {
      throw new Error('url é obrigatório para http_get');
    }

    const toolName = call?.name ?? 'http_get';
    const callId = call?.id;
    const url = this.validateExternalUrl(urlArg);
    const headers = this.sanitizeHeaders((args as Record<string, unknown>).headers);
    const maxResponseChars = this.resolveHttpToolMaxResponseChars(job);
    const requestedAt = new Date().toISOString();

    this.log(job, `${toolName}: ${url.toString()} (timeoutMs=${this.httpToolTimeoutMs}, maxResponseChars=${maxResponseChars})`);

    const controller = AbortSignal.timeout(this.httpToolTimeoutMs);
    let response: any;
    try {
      response = await this.fetchImpl(url.toString(), { method: 'GET', headers, signal: controller });
    } catch (err) {
      if (this.isTimeoutError(err)) {
        job.timeoutCount = (job.timeoutCount ?? 0) + 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`falha ao buscar URL: ${message}`);
    }

    const headersObject: Record<string, string> = {};
    try {
      for (const [key, value] of response.headers?.entries?.() ?? []) {
        headersObject[key] = value;
      }
    } catch {
      // noop - headers optional
    }

    let body = '';
    let truncated = false;
    try {
      const text = await response.text();
      const truncation = this.truncateStringValue(text, maxResponseChars);
      body = truncation.value;
      truncated = truncation.truncated;
      if (truncation.truncated) {
        this.log(job, `${toolName}: corpo truncado (omitiu ${truncation.omitted} caracteres)`);
      }
    } catch (err) {
      if (this.isTimeoutError(err)) {
        job.timeoutCount = (job.timeoutCount ?? 0) + 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`falha ao ler corpo da resposta: ${message}`);
    }

    const status = typeof response?.status === 'number' ? response.status : undefined;
    const success = this.isSuccessfulHttpResponse(response);
    if (success) {
      job.httpGetSuccessCount = (job.httpGetSuccessCount ?? 0) + 1;
    }

    this.recordHttpRequest(job, {
      callId,
      url: url.toString(),
      status,
      success,
      toolName,
      requestedAt,
    });

    return {
      url: url.toString(),
      status,
      statusText: response.statusText,
      headers: headersObject,
      body,
      truncated,
    };
  }

  private recordHttpRequest(job: SandboxJob, entry: SandboxHttpRequestLog) {
    job.httpRequests = Array.isArray(job.httpRequests) ? job.httpRequests : [];
    job.httpRequests.push(entry);
  }

  private isSuccessfulHttpResponse(response: any): boolean {
    if (response?.ok === true) {
      return true;
    }
    if (response?.ok === false) {
      return false;
    }
    const status = typeof response?.status === 'number' ? response.status : undefined;
    if (status === undefined) {
      return false;
    }
    return status >= 200 && status < 300;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const name = (error.name ?? '').toLowerCase();
    const message = (error.message ?? '').toLowerCase();
    return name.includes('abort') || name.includes('timeout') || message.includes('aborted') || message.includes('timeout');
  }

  private getMaxBufferBytes(): number {
    const maxBufferEnv = Number(process.env.RUN_SHELL_MAX_BUFFER_BYTES);
    return Number.isFinite(maxBufferEnv) && maxBufferEnv > 0 ? maxBufferEnv : 5 * 1024 * 1024;
  }

  private appendWithLimit(current: string, chunk: string, max: number): { value: string; truncated: boolean } {
    if (current.length >= max) {
      return { value: current, truncated: true };
    }
    const remaining = max - current.length;
    if (chunk.length <= remaining) {
      return { value: current + chunk, truncated: false };
    }
    return { value: current + chunk.slice(0, remaining), truncated: true };
  }

  private shouldForceCiEnv(command: string[]): boolean {
    if (this.isTestCommand(command)) {
      return true;
    }
    const shellSubcommands = this.extractShellSubcommands(command);
    return shellSubcommands.some((subcommand) => this.isTestCommand(subcommand));
  }

  private isTestCommand(command: string[]): boolean {
    const normalized = this.stripEnvAssignments(command);
    if (normalized.length === 0) {
      return false;
    }
    const commandName = path.basename(normalized[0]);
    const args = normalized.slice(1);
    const testRunners = new Set(['vitest', 'jest', 'playwright']);
    const packageManagers = new Set(['npm', 'pnpm', 'yarn', 'bun']);
    const dlxCommands = new Set(['npx', 'pnpm', 'yarn', 'bunx']);
    const isTestToken = (token: string) => token === 'test' || token.startsWith('test:') || testRunners.has(token);

    if (testRunners.has(commandName)) {
      return true;
    }

    if (dlxCommands.has(commandName) && args.length > 0 && testRunners.has(args[0])) {
      return true;
    }

    if (!packageManagers.has(commandName)) {
      return false;
    }

    if (commandName === 'npm') {
      const scriptName = args[0] === 'run' ? args[1] : args[0];
      return typeof scriptName === 'string' && isTestToken(scriptName);
    }

    if (commandName === 'pnpm' || commandName === 'yarn' || commandName === 'bun') {
      const first = args[0];
      const scriptName = first === 'run' ? args[1] : first;
      return typeof scriptName === 'string' && isTestToken(scriptName);
    }

    return false;
  }

  private stripEnvAssignments(tokens: string[]): string[] {
    const normalized = [...tokens];
    while (normalized.length > 0 && this.isEnvAssignment(normalized[0])) {
      normalized.shift();
    }
    return normalized;
  }

  private isEnvAssignment(token: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(token);
  }

  private extractShellSubcommands(command: string[]): string[][] {
    if (command.length === 0) {
      return [];
    }
    const shellNames = new Set(['sh', 'bash', 'zsh', 'ksh', 'dash', 'ash', 'fish']);
    const commandName = path.basename(command[0]);
    if (!shellNames.has(commandName)) {
      return [];
    }

    const args = command.slice(1);
    const scriptCandidates: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (typeof arg !== 'string') {
        continue;
      }
      if (this.isShellExecuteFlag(arg)) {
        const script = args[i + 1];
        if (typeof script === 'string' && script.trim().length > 0) {
          scriptCandidates.push(script);
        }
        i += 1;
      }
    }

    if (scriptCandidates.length === 0 && args.length > 0) {
      const fallback = args[args.length - 1];
      if (typeof fallback === 'string' && fallback.trim().length > 0) {
        scriptCandidates.push(fallback);
      }
    }

    return scriptCandidates.flatMap((candidate) => this.tokenizeShellCommand(candidate));
  }

  private isShellExecuteFlag(arg: string): boolean {
    if (arg === '-c' || arg === '--command') {
      return true;
    }
    return /^-[^-]*c[^-]*$/.test(arg);
  }

  private tokenizeShellCommand(script: string): string[][] {
    return this.splitCompositeCommand(script)
      .map((segment) => this.tokenizeSegment(segment))
      .filter((tokens) => tokens.length > 0);
  }

  private splitCompositeCommand(script: string): string[] {
    return script
      .split(/&&|\|\||;|\n/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }

  private tokenizeSegment(segment: string): string[] {
    const matches = segment.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g);
    if (!matches) {
      return [];
    }
    return matches.map((token) => this.stripQuotes(token));
  }

  private stripQuotes(token: string): string {
    if (token.length >= 2) {
      const first = token[0];
      const last = token[token.length - 1];
      if (
        (first === '"' && last === '"') ||
        (first === '\'' && last === '\'') ||
        (first === '`' && last === '`')
      ) {
        return token.slice(1, -1);
      }
    }
    return token;
  }

  private resolvePath(repoPath: string, requested: string | undefined, job?: SandboxJob): string {
    if (!requested) {
      throw new Error('path ausente');
    }
    const sanitized = this.sanitizeRequestedPath(requested);
    if (!sanitized) {
      throw new Error('path ausente');
    }
    if (sanitized !== requested && job) {
      this.log(job, `normalizando caminho solicitado de "${requested}" para "${sanitized}"`);
    }
    const absolute = path.resolve(repoPath, sanitized);
    if (!absolute.startsWith(repoPath)) {
      throw new Error('Acesso a caminho fora do sandbox bloqueado');
    }
    return absolute;
  }

  private normalizeRepoPath(
    repoPath: string,
    requested: string | undefined,
  ): { absolute: string; relative: string } {
    const absolute = this.resolvePath(repoPath, requested);
    const relative = path.relative(repoPath, absolute) || path.basename(absolute);
    return { absolute, relative };
  }

  private async handleRunShell(args: Record<string, unknown>, repoPath: string, job: SandboxJob) {
    const now = Date.now();
    let command = Array.isArray(args.command) ? (args.command as string[]) : undefined;
    if (!command || command.length === 0) {
      throw new Error('command é obrigatório para run_shell');
    }
    const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
    const cwd = await this.resolveCwdWithAutocorrect(job, repoPath, cwdArg);
    await this.assertDirectoryExists(cwd);

    command = command.map((part) => part.trim());
    const isRecursiveGrep = command[0] === 'grep' && command[1] === '-R';
    if (isRecursiveGrep && command.length <= 2) {
      const message = 'grep -R detectado. Use rg <padrao> <caminho> para buscas recursivas no sandbox.';
      this.log(job, message);
      throw new Error(message);
    }

    if (isRecursiveGrep) {
      const rgCommand = ['rg', ...command.slice(2)];
      this.log(
        job,
        `comando grep -R detectado; substituindo por rg para busca recursiva: ${command.join(' ')} -> ${rgCommand.join(
          ' ',
        )}`,
      );
      command = rgCommand;
    }

    const joined = command.join(' ');
    const cachedResult = this.tryReuseShortTermShellCache(job, cwd, joined, now);
    if (cachedResult) {
      return cachedResult;
    }
    const timeoutEnv = Number(process.env.RUN_SHELL_TIMEOUT_MS);
    const defaultTimeoutMs = Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 300_000;
    const isMavenCommand = path.basename(command[0]) === 'mvn';
    const mavenTimeoutMs = 15 * 60 * 1000;
    const timeoutMs = isMavenCommand ? Math.max(defaultTimeoutMs, mavenTimeoutMs) : defaultTimeoutMs;
    if (isMavenCommand && timeoutMs > defaultTimeoutMs) {
      this.log(job, 'mvn detectado; aumentando timeout para 15 minutos');
    }
    const maxBuffer = this.getMaxBufferBytes();

    this.log(
      job,
      `run_shell: ${joined} (cwd=${cwd}, timeoutMs=${timeoutMs}, maxBufferBytes=${maxBuffer})`,
    );

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const forceCi = this.shouldForceCiEnv(command);
    const state = this.getOrThrowRunnerEnvironmentState(job, repoPath);
    const baseEnv = { ...process.env };
    if (state.supplementalBinPath) {
      const pathEnv = process.platform === 'win32' ? 'Path' : 'PATH';
      const currentPath = baseEnv[pathEnv] ?? '';
      baseEnv[pathEnv] = currentPath
        ? `${state.supplementalBinPath}${path.delimiter}${currentPath}`
        : state.supplementalBinPath;
    }
    const env = forceCi ? { ...baseEnv, CI: '1', NODE_ENV: 'test' } : baseEnv;
    if (forceCi) {
      this.log(job, `run_shell: CI=1 aplicado para evitar modo watch`);
      this.log(job, `run_shell: NODE_ENV=test aplicado para evitar React em modo produção durante testes`);
    }

    const child = spawn(command[0], command.slice(1), { cwd, env });

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const result = this.appendWithLimit(stdout, chunk, maxBuffer);
      stdout = result.value;
      stdoutTruncated = stdoutTruncated || result.truncated;
      this.log(job, `run_shell stdout: ${this.truncate(chunk, 500)}`);
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const result = this.appendWithLimit(stderr, chunk, maxBuffer);
      stderr = result.value;
      stderrTruncated = stderrTruncated || result.truncated;
      this.log(job, `run_shell stderr: ${this.truncate(chunk, 500)}`);
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      this.log(job, `run_shell atingiu timeout de ${timeoutMs}ms; finalizando processo`);
      child.kill('SIGKILL');
    }, timeoutMs);

    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        resolve({ code, signal });
      });
    });

    if (stdoutTruncated || stderrTruncated) {
      this.log(job, 'run_shell output truncado para respeitar maxBuffer');
    }
    this.log(
      job,
      `run_shell finalizado (code=${exitResult.code}, signal=${exitResult.signal}, timedOut=${timedOut})`,
    );
    if (timedOut) {
      job.timeoutCount = (job.timeoutCount ?? 0) + 1;
    }

    const result = {
      stdout,
      stderr,
      exitCode: exitResult.code,
      signal: exitResult.signal,
      timedOut,
      stdoutTruncated,
      stderrTruncated,
    };
    this.storeShortTermShellCache(job, cwd, joined, result, now);

    return result;
  }


  private tryReuseShortTermShellCache(
    job: SandboxJob,
    cwd: string,
    command: string,
    now: number,
  ):
    | {
        stdout: string;
        stderr: string;
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        timedOut: boolean;
        stdoutTruncated: boolean;
        stderrTruncated: boolean;
      }
    | undefined {
    const state = this.getLayeredContextState(job);
    this.pruneExpiredShellCache(state, now);
    const commandKey = this.buildShellCommandKey(cwd, command);
    const existing = state.shellCommandCache.get(commandKey);
    const trackedCommand = this.trackShellCommandMetric(job, state.shellMetrics, commandKey);
    const window = this.parseSedFileWindow(command);

    if (existing && now - existing.createdAt <= this.shellShortTermCacheTtlMs) {
      this.log(job, `run_shell cache hit: reutilizando resultado recente para ${command} (cwd=${cwd})`);
      if (trackedCommand.isDuplicate) {
        this.logShellDuplicateAlert(job, state.shellMetrics);
      }
      return existing.result;
    }

    if (window) {
      const overlapped = this.findOverlappingShellWindow(state, cwd, window, now);
      if (overlapped) {
        this.log(
          job,
          `run_shell cache hit (janela de arquivo): reutilizando ${command} com base em leitura sobreposta recente`,
        );
        if (trackedCommand.isDuplicate) {
          this.logShellDuplicateAlert(job, state.shellMetrics);
        }
        return overlapped.result;
      }
    }

    if (trackedCommand.isDuplicate) {
      this.logShellDuplicateAlert(job, state.shellMetrics);
    }
    return undefined;
  }

  private storeShortTermShellCache(
    job: SandboxJob,
    cwd: string,
    command: string,
    result: {
      stdout: string;
      stderr: string;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
    },
    now: number,
  ): void {
    if (!this.isIdempotentReadCommand(command)) {
      return;
    }
    const state = this.getLayeredContextState(job);
    const key = this.buildShellCommandKey(cwd, command);
    const window = this.parseSedFileWindow(command);
    state.shellCommandCache.set(key, {
      key,
      cwd,
      command,
      result,
      createdAt: now,
      window,
    });
    this.pruneExpiredShellCache(state, now);
  }

  private pruneExpiredShellCache(state: LayeredContextState, now: number): void {
    for (const [key, entry] of state.shellCommandCache.entries()) {
      if (now - entry.createdAt > this.shellShortTermCacheTtlMs) {
        state.shellCommandCache.delete(key);
      }
    }
  }

  private findOverlappingShellWindow(
    state: LayeredContextState,
    cwd: string,
    requestedWindow: FileWindowRequest,
    now: number,
  ): ShellCommandCacheEntry | undefined {
    for (const entry of state.shellCommandCache.values()) {
      if (!entry.window || entry.cwd !== cwd) {
        continue;
      }
      if (now - entry.createdAt > this.shellShortTermCacheTtlMs) {
        continue;
      }
      if (entry.window.file !== requestedWindow.file) {
        continue;
      }
      if (entry.result.exitCode !== 0 || entry.result.timedOut) {
        continue;
      }
      const overlapStart = Math.max(entry.window.startLine, requestedWindow.startLine);
      const overlapEnd = Math.min(entry.window.endLine, requestedWindow.endLine);
      if (overlapStart <= overlapEnd) {
        return entry;
      }
    }
    return undefined;
  }

  private trackShellCommandMetric(
    job: SandboxJob,
    metrics: ShellCommandMetrics,
    signature: string,
  ): { isDuplicate: boolean; repetitionRate: number } {
    metrics.totalCommands += 1;
    const seen = metrics.uniqueBySignature.get(signature) ?? 0;
    metrics.uniqueBySignature.set(signature, seen + 1);
    const isDuplicate = seen > 0;
    if (isDuplicate) {
      metrics.duplicateCommands += 1;
    }
    const repetitionRate = metrics.totalCommands > 0 ? metrics.duplicateCommands / metrics.totalCommands : 0;
    this.log(
      job,
      `run_shell métricas: total=${metrics.totalCommands}, únicos=${metrics.uniqueBySignature.size}, repetição=${(
        repetitionRate * 100
      ).toFixed(1)}%`,
    );
    return { isDuplicate, repetitionRate };
  }

  private logShellDuplicateAlert(job: SandboxJob, metrics: ShellCommandMetrics): void {
    if (metrics.totalCommands <= 0) {
      return;
    }
    const repetitionRate = metrics.duplicateCommands / metrics.totalCommands;
    if (repetitionRate <= metrics.alertThreshold) {
      return;
    }
    this.log(
      job,
      `ALERTA run_shell: taxa de repetição ${(repetitionRate * 100).toFixed(1)}% acima do limite ${(metrics.alertThreshold * 100).toFixed(1)}%.`,
    );
  }

  private buildShellCommandKey(cwd: string, command: string): string {
    return `${cwd}::${command.trim()}`;
  }

  private isIdempotentReadCommand(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) {
      return false;
    }
    return /^(sed|cat|rg|ls)(\s|$)/.test(trimmed);
  }

  private parseSedFileWindow(command: string): FileWindowRequest | undefined {
    const trimmed = command.trim();
    const match = trimmed.match(/^sed\s+-n\s+['"]?(\d+),(\d+)p['"]?\s+(.+)$/);
    if (!match) {
      return undefined;
    }
    const startLine = Number(match[1]);
    const endLine = Number(match[2]);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine < startLine) {
      return undefined;
    }
    return {
      file: match[3].trim(),
      startLine,
      endLine,
    };
  }

  private async runRunnerPreflight(job: SandboxJob, repoPath: string): Promise<void> {
    const resolvedRepoPath = path.resolve(repoPath);
    const realRepoPath = await fs.realpath(resolvedRepoPath).catch(() => resolvedRepoPath);
    const repoExists = await this.isGitRepository(realRepoPath);
    if (!repoExists) {
      throw new Error(`preflight falhou: repositório git não encontrado em ${realRepoPath}`);
    }

    await fs.access(realRepoPath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);

    const essentialTools = ['bash', 'git', 'rg'];
    const browserTools = ['chromium'];
    const hardRequirements = ['bash', 'git'];
    for (const tool of hardRequirements) {
      const available = await this.isCommandAvailable(tool);
      if (!available) {
        throw new Error(`preflight falhou: tool essencial indisponível (${tool})`);
      }
    }

    let supplementalBinPath: string | undefined;
    const rgAvailable = await this.isCommandAvailable('rg');
    if (!rgAvailable) {
      supplementalBinPath = await this.ensureRipgrepFallback(realRepoPath);
      this.log(
        job,
        `tool rg não encontrada no runner; fallback compatível foi provisionado em ${supplementalBinPath}`,
      );
    }

    const state: RunnerEnvironmentState = {
      repoPath: realRepoPath,
      validatedCwd: realRepoPath,
      branch: job.branch,
      permissionProfile: 'read-write-execute',
      essentialTools,
      browserTools,
      supplementalBinPath,
      validatedAt: new Date().toISOString(),
      repeatedErrorBySignature: new Map(),
    };
    this.runnerEnvironmentStates.set(job, state);
    this.log(job, `preflight do runner concluído com sucesso (cwd=${realRepoPath}, branch=${job.branch})`);
  }

  private getOrThrowRunnerEnvironmentState(job: SandboxJob, repoPath: string): RunnerEnvironmentState {
    const state = this.runnerEnvironmentStates.get(job);
    if (!state) {
      throw new Error('estado de ambiente do runner ausente; execute o preflight antes do loop');
    }
    if (state.repoPath !== path.resolve(repoPath) && state.repoPath !== repoPath) {
      throw new Error('estado de ambiente inválido para o repositório atual');
    }
    return state;
  }

  private buildEnvironmentChecklist(state: RunnerEnvironmentState): string {
    return [
      '- [x] cwd real validado',
      `- [x] repositório git acessível em ${state.validatedCwd}`,
      `- [x] branch validada: ${state.branch}`,
      `- [x] permissões: ${state.permissionProfile}`,
      `- [x] tools essenciais: ${state.essentialTools.join(', ')}`,
      `- [x] navegador headless disponível para screenshots: ${state.browserTools.join(', ')} (/usr/bin/chromium; CHROME_BIN/CHROMIUM_BIN/PUPPETEER_EXECUTABLE_PATH/PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)`,
      `- [x] estado validado em: ${state.validatedAt}`,
    ].join('\n');
  }

  private async resolveCwdWithAutocorrect(job: SandboxJob, repoPath: string, cwdArg?: string): Promise<string> {
    const state = this.getOrThrowRunnerEnvironmentState(job, repoPath);
    if (!cwdArg) {
      return state.validatedCwd;
    }
    try {
      const resolved = this.resolvePath(repoPath, cwdArg, job);
      await this.assertDirectoryExists(resolved);
      return resolved;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(
        job,
        `cwd inválido detectado (${cwdArg}); aplicando autocorreção imediata para ${state.validatedCwd}. Motivo: ${reason}`,
      );
      return state.validatedCwd;
    }
  }

  private evaluateRepeatedToolErrorBlock(
    job: SandboxJob,
    toolSignature: string,
    toolName: string,
  ): EcoTwoLoopBlockResult | undefined {
    const state = this.runnerEnvironmentStates.get(job);
    const repeated = state?.repeatedErrorBySignature.get(toolSignature);
    if (!repeated || repeated.count < 2) {
      return undefined;
    }
    return {
      payload: {
        error:
          'Runner bloqueou retry cego: mesma assinatura de erro repetida. Altere a estratégia antes de tentar novamente.',
        tool: toolName || 'desconhecida',
        attempts: repeated.count,
      },
      logMessage: `retry cego bloqueado para ${toolName || 'tool'} após ${repeated.count} erros idênticos`,
    };
  }

  private recordRepeatedErrorAttempt(job: SandboxJob, toolSignature: string, message: string): void {
    const state = this.runnerEnvironmentStates.get(job);
    if (!state) {
      return;
    }
    const normalized = this.normalizeErrorSignature(message);
    const previous = state.repeatedErrorBySignature.get(toolSignature);
    if (!previous || previous.errorSignature !== normalized) {
      state.repeatedErrorBySignature.set(toolSignature, { errorSignature: normalized, count: 1 });
      return;
    }
    state.repeatedErrorBySignature.set(toolSignature, {
      errorSignature: normalized,
      count: previous.count + 1,
    });
  }

  private resetRepeatedErrorState(job: SandboxJob, toolSignature: string): void {
    this.runnerEnvironmentStates.get(job)?.repeatedErrorBySignature.delete(toolSignature);
  }

  private normalizeErrorSignature(message: string): string {
    return message
      .toLowerCase()
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async isCommandAvailable(command: string): Promise<boolean> {
    try {
      const { shell, args } = this.getShellCommand(`command -v ${command}`);
      const result = await new Promise<number>((resolve, reject) => {
        const child = spawn(shell, args);
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
      });
      return result === 0;
    } catch {
      return false;
    }
  }


  private async ensureRipgrepFallback(repoPath: string): Promise<string> {
    const binDir = path.join(repoPath, '.ai-hub-bin');
    await fs.mkdir(binDir, { recursive: true });
    const rgPath = path.join(binDir, 'rg');
    const shim = `#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -eq 0 ]; then
  echo "usage: rg <pattern> <path>" >&2
  exit 2
fi
grep -R -n -- "$@"
`;
    await fs.writeFile(rgPath, shim, { mode: 0o755 });
    await fs.chmod(rgPath, 0o755).catch(() => undefined);
    return binDir;
  }

  private async runGitCommand(
    command: string,
    repoPath: string,
    job?: SandboxJob,
    allowedExitCodes: number[] = [0],
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }> {
    const maxBuffer = this.getMaxBufferBytes();
    if (job) {
      this.log(job, `git comando: ${command} (cwd=${repoPath}, maxBufferBytes=${maxBuffer})`);
    }

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let stdoutTruncationLogged = false;
    let stderrTruncationLogged = false;

    const { shell, args } = this.getShellCommand(command);
    const child = spawn(shell, args, { cwd: repoPath });

    const logIfTruncated = (stream: 'stdout' | 'stderr', truncated: boolean) => {
      if (!truncated) {
        return;
      }
      if (stream === 'stdout' && stdoutTruncationLogged) {
        return;
      }
      if (stream === 'stderr' && stderrTruncationLogged) {
        return;
      }
      const message = `git ${stream} truncado após atingir maxBufferBytes=${maxBuffer} para comando: ${command}`;
      if (job) {
        this.log(job, message);
      } else {
        console.warn(message);
      }
      if (stream === 'stdout') {
        stdoutTruncationLogged = true;
      } else {
        stderrTruncationLogged = true;
      }
    };

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const result = this.appendWithLimit(stdout, chunk, maxBuffer);
      stdout = result.value;
      const wasTruncated = stdoutTruncated || result.truncated;
      if (!stdoutTruncated && wasTruncated) {
        logIfTruncated('stdout', true);
      }
      stdoutTruncated = wasTruncated;
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const result = this.appendWithLimit(stderr, chunk, maxBuffer);
      stderr = result.value;
      const wasTruncated = stderrTruncated || result.truncated;
      if (!stderrTruncated && wasTruncated) {
        logIfTruncated('stderr', true);
      }
      stderrTruncated = wasTruncated;
    });

    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on('error', (err) => reject(err));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });

    if (stdoutTruncated || stderrTruncated) {
      logIfTruncated('stdout', stdoutTruncated);
      logIfTruncated('stderr', stderrTruncated);
    }

    if (exitResult.code !== null && !allowedExitCodes.includes(exitResult.code)) {
      const error = new Error(
        `git comando falhou (exitCode=${exitResult.code}, signal=${exitResult.signal}): ${command}`,
      ) as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        signal?: NodeJS.Signals | null;
      };
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = exitResult.code === null ? undefined : exitResult.code.toString();
      error.exitCode = exitResult.code ?? undefined;
      error.signal = exitResult.signal;
      throw error;
    }

    return { stdout, stderr, exitCode: exitResult.code, stdoutTruncated, stderrTruncated };
  }

  private getShellCommand(command: string): { shell: string; args: string[] } {
    if (process.platform === 'win32') {
      const shell = process.env.COMSPEC || 'cmd.exe';
      return { shell, args: ['/d', '/s', '/c', command] };
    }

    const shell = process.env.SHELL || '/bin/sh';
    return { shell, args: ['-c', command] };
  }

  private async handleReadImage(args: Record<string, unknown>, repoPath: string, job: SandboxJob): Promise<ImageToolResult> {
    const { absolute, relative } = this.normalizeRepoPath(
      repoPath,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const stat = await fs.stat(absolute);
    const maxBytes = this.resolveImageToolMaxBytes();
    if (!stat.isFile()) {
      throw new Error('read_image aceita apenas arquivos');
    }
    if (stat.size > maxBytes) {
      throw new Error(`imagem excede limite de ${maxBytes} bytes`);
    }
    const buffer = await fs.readFile(absolute);
    return this.buildImageToolResult({
      source: 'read_image',
      buffer,
      fallbackName: relative,
      path: relative,
      job,
    });
  }

  private async handleFetchImage(call: ToolCall, job: SandboxJob): Promise<ImageToolResult> {
    if (!this.fetchImpl) {
      throw new Error('fetch indisponível para fetch_image');
    }

    const args = call?.arguments ?? {};
    const urlArg = typeof args.url === 'string' ? args.url : undefined;
    if (!urlArg) {
      throw new Error('url é obrigatório para fetch_image');
    }

    const url = this.validateExternalUrl(urlArg);
    const headers = this.sanitizeHeaders((args as Record<string, unknown>).headers);
    const requestedAt = new Date().toISOString();
    this.log(job, `fetch_image: ${url.toString()} (timeoutMs=${this.httpToolTimeoutMs}, maxBytes=${this.resolveImageToolMaxBytes()})`);

    let response: any;
    try {
      response = await this.fetchImpl(url.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(this.httpToolTimeoutMs) });
    } catch (err) {
      if (this.isTimeoutError(err)) {
        job.timeoutCount = (job.timeoutCount ?? 0) + 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`falha ao buscar imagem: ${message}`);
    }

    const status = typeof response?.status === 'number' ? response.status : undefined;
    const success = this.isSuccessfulHttpResponse(response);
    this.recordHttpRequest(job, {
      callId: call.id,
      url: url.toString(),
      status,
      success,
      toolName: call.name,
      requestedAt,
    });
    if (!success) {
      throw new Error(`falha ao buscar imagem: status ${status ?? 'desconhecido'}`);
    }

    const contentLength = Number(response.headers?.get?.('content-length'));
    const maxBytes = this.resolveImageToolMaxBytes();
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`imagem excede limite de ${maxBytes} bytes`);
    }

    let buffer: Buffer;
    try {
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (err) {
      if (this.isTimeoutError(err)) {
        job.timeoutCount = (job.timeoutCount ?? 0) + 1;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`falha ao ler imagem: ${message}`);
    }
    if (buffer.byteLength > maxBytes) {
      throw new Error(`imagem excede limite de ${maxBytes} bytes`);
    }

    return this.buildImageToolResult({
      source: 'fetch_image',
      buffer,
      fallbackName: path.basename(url.pathname),
      url: url.toString(),
      job,
    });
  }

  private buildImageToolResult(input: {
    source: 'read_image' | 'fetch_image';
    buffer: Buffer;
    fallbackName: string;
    path?: string;
    url?: string;
    job: SandboxJob;
  }): ImageToolResult {
    const mimeType = this.detectImageMimeType(input.buffer, input.fallbackName);
    if (!mimeType || !IMAGE_TOOL_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error('formato de imagem não suportado; use PNG, JPG, WebP ou GIF');
    }
    const dataUrl = `data:${mimeType};base64,${input.buffer.toString('base64')}`;
    this.log(input.job, `${input.source}: imagem preparada para visão multimodal (${mimeType}, ${input.buffer.byteLength} bytes)`);
    return {
      type: 'image',
      source: input.source,
      path: input.path,
      url: input.url,
      mimeType,
      sizeBytes: input.buffer.byteLength,
      dataUrl,
      note: 'Imagem anexada ao próximo turno como input_image para inspeção visual multimodal.',
    };
  }

  private buildImageToolMessage(result: unknown): ResponseItem | undefined {
    if (!this.isImageToolResult(result)) {
      return undefined;
    }
    const label = result.path ?? result.url ?? 'imagem';
    return {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Imagem carregada por ${result.source}: ${label}. Analise visualmente esta imagem antes de concluir a tarefa.`,
        },
        {
          type: 'input_image',
          image_url: result.dataUrl,
          detail: 'high',
        },
      ],
    } as ResponseItem;
  }

  private isImageToolResult(result: unknown): result is ImageToolResult {
    return Boolean(
      result
        && typeof result === 'object'
        && (result as Record<string, unknown>).type === 'image'
        && typeof (result as Record<string, unknown>).dataUrl === 'string'
        && typeof (result as Record<string, unknown>).mimeType === 'string',
    );
  }

  private detectImageMimeType(buffer: Buffer, fallbackName: string): string | undefined {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'image/webp';
    }
    if (buffer.length >= 6) {
      const signature = buffer.subarray(0, 6).toString('ascii');
      if (signature === 'GIF87a' || signature === 'GIF89a') {
        return 'image/gif';
      }
    }
    const ext = path.extname(fallbackName).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return undefined;
  }

  private resolveImageToolMaxBytes(): number {
    const maxBytes = Number(process.env.IMAGE_TOOL_MAX_BYTES);
    return Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 5 * 1024 * 1024;
  }

  private async handleReadFile(args: Record<string, unknown>, repoPath: string) {
    const { absolute, relative } = this.normalizeRepoPath(
      repoPath,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const content = await fs.readFile(absolute, 'utf8');
    return { path: relative, content };
  }

  private async handleWriteFile(args: Record<string, unknown>, repoPath: string, job: SandboxJob) {
    const { absolute, relative } = this.normalizeRepoPath(
      repoPath,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const content = typeof args.content === 'string' ? args.content : '';
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
    this.log(job, `write_file: ${absolute}`);
    this.resetEcoTwoLoopAttempts(job, 'write_file executada');
    return { status: 'ok', path: relative, content };
  }

  private async listUntrackedFiles(repoPath: string, job?: SandboxJob): Promise<string[]> {
    const statusLines = await this.getStatusLines(repoPath, job);
    return statusLines
      .filter((line) => line.startsWith('?? '))
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0);
  }

  private async getStatusLines(repoPath: string, job?: SandboxJob): Promise<string[]> {
    const { stdout } = await this.runGitCommand('git status --porcelain=v1 --untracked-files=all', repoPath, job);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths));
  }

  private isInternalWorkspacePath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized === '.ai-hub-bin' || normalized.startsWith('.ai-hub-bin/');
  }

  private async collectChangedFiles(repoPath: string, baseCommit?: string, job?: SandboxJob): Promise<string[]> {
    if (!(await this.isGitRepository(repoPath))) {
      return [];
    }
    const { stdout } = await this.runGitCommand(`git diff --name-only ${baseCommit ?? 'HEAD'}`, repoPath, job);
    const tracked = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !this.isInternalWorkspacePath(line));
    const untracked = (await this.listUntrackedFiles(repoPath, job)).filter(
      (file) => !this.isInternalWorkspacePath(file),
    );
    return this.uniquePaths([...tracked, ...untracked]);
  }

  private async generatePatch(repoPath: string, baseCommit?: string, job?: SandboxJob): Promise<string> {
    if (!(await this.isGitRepository(repoPath))) {
      return '';
    }
    const { stdout: trackedDiff } = await this.runGitCommand(`git diff ${baseCommit ?? 'HEAD'}`, repoPath, job);
    const untracked = (await this.listUntrackedFiles(repoPath, job)).filter(
      (file) => !this.isInternalWorkspacePath(file),
    );

    const untrackedDiffs: string[] = [];
    for (const file of untracked) {
      const escaped = this.escapePathForShell(file);
      try {
        const { stdout } = await this.runGitCommand(
          `git diff --no-index --binary -- /dev/null ${escaped}`,
          repoPath,
          job,
          [0, 1],
        );
        if (stdout.trim().length > 0) {
          untrackedDiffs.push(stdout);
        }
      } catch (err: any) {
        if (err?.code === 1 && typeof err.stdout === 'string' && err.stdout.trim().length > 0) {
          // git diff --no-index retorna exit code 1 quando diferenças são encontradas
          untrackedDiffs.push(err.stdout);
        } else {
          throw err;
        }
      }
    }

    return [trackedDiff, ...untrackedDiffs].filter((chunk) => chunk.trim().length > 0).join('\n');
  }

  private async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      await fs.stat(path.join(repoPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private resolveRepoSlug(job: SandboxJob): string | undefined {
    if (job.repoSlug) {
      return job.repoSlug;
    }

    try {
      const parsed = new URL(job.repoUrl);
      if (parsed.hostname.toLowerCase() !== 'github.com') {
        return undefined;
      }
      const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async getHeadCommit(repoPath: string): Promise<string | undefined> {
    if (!(await this.isGitRepository(repoPath))) {
      return undefined;
    }
    try {
      const { stdout } = await exec('git rev-parse HEAD', { cwd: repoPath });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async maybeCreatePullRequest(
    job: SandboxJob,
    repoPath: string,
    githubAuth: { token?: string; username: string; source: string },
    baseCommit?: string,
    diffPatch?: string,
  ): Promise<void> {
    this.ensureNotCancelled(job);
    const token = githubAuth.token;
    if (!token) {
      this.log(job, 'nenhum token GitHub disponível; ignorando criação de PR');
      return;
    }

    const repoSlug = this.resolveRepoSlug(job);
    if (!repoSlug) {
      this.log(job, 'repoSlug ausente e repoUrl não é github.com; não é possível criar PR');
      return;
    }

    if (!this.fetchImpl) {
      this.log(job, 'fetch API indisponível; não é possível criar PR');
      return;
    }

    if (!(await this.isGitRepository(repoPath))) {
      this.log(job, 'repositório git ausente, não é possível criar PR');
      return;
    }

    const diff = diffPatch ?? (await this.generatePatch(repoPath, baseCommit, job));
    if (!diff.trim()) {
      this.log(job, 'nenhuma alteração detectada; PR não será criado');
      return;
    }

    const branchName = this.resolveWorkBranch(job);
    try {
      await exec('git config user.email "ai-hub-bot@example.com"', { cwd: repoPath });
      await exec('git config user.name "AI Hub Bot"', { cwd: repoPath });
      const existingRemoteBranch = await this.checkoutWorkBranch(repoPath, branchName);
      if (existingRemoteBranch) {
        this.log(job, `branch de trabalho existente reutilizada: ${branchName}`);
      } else {
        this.log(job, `branch de trabalho criada: ${branchName}`);
      }
      await exec('git add -A', { cwd: repoPath });
      const statusLines = await this.getStatusLines(repoPath, job);
      if (statusLines.length > 0) {
        await exec('git commit -m "Correção automática do AI Hub"', { cwd: repoPath });
      } else {
        this.log(job, 'nenhuma alteração nova para commitar; mantendo commits existentes da branch de trabalho');
      }

      const authenticatedRemote = buildAuthRepoUrl(
        job.repoUrl,
        token,
        githubAuth.username,
      );
      await exec(`git remote set-url origin ${authenticatedRemote}`, { cwd: repoPath });
      try {
        await exec(`git push origin ${branchName}`, { cwd: repoPath });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = this.permissionHintFromMessage(message);
        throw new Error(
          `Falha ao fazer push para criar PR: ${message}${hint ? ` (${hint})` : ''}`,
        );
      }

      const prTitle = this.buildPrTitle(job.summary);
      const prBody = this.buildPrBody(job.summary, job.taskDescription);
      const pr = await this.createOrReusePullRequest(
        job,
        repoSlug,
        token,
        branchName,
        job.branch,
        prTitle,
        prBody,
      );
      if (pr?.html_url) {
        job.pullRequestUrl = pr.html_url;
        this.log(job, `pull request criado em ${job.pullRequestUrl}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(job, `falha ao criar pull request: ${message}`);
    }
  }


  private resolveWorkBranch(job: SandboxJob): string {
    const fallback = `ai-hub/cifix-${job.jobId}`;
    const branch = job.workBranch?.trim();
    if (!branch) {
      return fallback;
    }
    if (!this.isValidWorkBranchName(branch)) {
      this.log(job, `workBranch inválida ignorada: ${branch}`);
      return fallback;
    }
    return branch;
  }

  private async checkoutWorkBranch(repoPath: string, branchName: string): Promise<boolean> {
    try {
      await exec(`git fetch origin ${branchName}:refs/remotes/origin/${branchName}`, { cwd: repoPath });
      await exec(`git checkout -B ${branchName} refs/remotes/origin/${branchName}`, { cwd: repoPath });
      return true;
    } catch {
      await exec(`git checkout -B ${branchName}`, { cwd: repoPath });
      return false;
    }
  }


  private async checkoutExistingWorkBranchForContext(job: SandboxJob, repoPath: string): Promise<void> {
    const branchName = job.workBranch?.trim();
    if (!branchName) {
      return;
    }
    if (!this.isValidWorkBranchName(branchName)) {
      this.log(job, `workBranch inválida ignorada no preparo do contexto: ${branchName}`);
      return;
    }

    try {
      await exec(`git fetch origin ${branchName}:refs/remotes/origin/${branchName}`, { cwd: repoPath });
      await exec(`git checkout -B ${branchName} refs/remotes/origin/${branchName}`, { cwd: repoPath });
      this.log(job, `branch de trabalho existente carregada antes da execução: ${branchName}`);
    } catch {
      this.log(job, `nenhuma branch de trabalho remota encontrada antes da execução: ${branchName}`);
    }
  }

  private isValidWorkBranchName(branch: string): boolean {
    return /^[A-Za-z0-9._/-]+$/.test(branch) && !branch.includes('..') && !branch.startsWith('/') && !branch.endsWith('/');
  }

  private async createOrReusePullRequest(
    job: SandboxJob,
    repoSlug: string,
    token: string,
    head: string,
    baseBranch: string,
    title: string,
    body: string,
  ): Promise<any> {
    try {
      return await this.createPullRequestWithRetry(job, repoSlug, token, head, baseBranch, title, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Falha ao criar PR: 422')) {
        throw error;
      }
      const existing = await this.findOpenPullRequest(job, repoSlug, token, head, baseBranch);
      if (existing) {
        this.log(job, `pull request existente reutilizado para branch ${head}`);
        return existing;
      }
      throw error;
    }
  }

  private async findOpenPullRequest(
    job: SandboxJob,
    repoSlug: string,
    token: string,
    head: string,
    baseBranch: string,
  ): Promise<any | null> {
    if (!this.fetchImpl) {
      return null;
    }
    const [owner] = repoSlug.split('/');
    const url = `${this.githubApiBase}/repos/${repoSlug}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(baseBranch)}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) {
      this.log(job, `falha ao consultar PR existente: ${response.status}`);
      return null;
    }
    const pulls = await response.json().catch(() => []);
    return Array.isArray(pulls) && pulls.length > 0 ? pulls[0] : null;
  }


  private async createPullRequestWithRetry(
    job: SandboxJob,
    repoSlug: string,
    token: string,
    head: string,
    baseBranch: string,
    title: string,
    body: string,
  ): Promise<any> {
    if (!this.fetchImpl) {
      throw new Error('fetch API indisponível; não é possível criar PR');
    }
    const maxAttempts = Math.max(1, this.prCreateMaxAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.githubApiBase}/repos/${repoSlug}/pulls`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({ title, head, base: baseBranch, body }),
        });

        if (!response.ok) {
          const rawBody = (await response.text().catch(() => '')) ?? '';
          const normalized = rawBody.trim().length > 0 ? rawBody : 'erro desconhecido da API do GitHub';
          const message = this.truncate(normalized, 400);
          const permissionHint =
            response.status === 401 || response.status === 403
              ? 'token pode estar sem permissão de pull request ou push'
              : undefined;

          if (this.shouldRetryPullRequestStatus(response.status) && attempt < maxAttempts) {
            const delayMs = this.calculatePrRetryDelay(attempt);
            this.log(
              job,
              `tentativa ${attempt}/${maxAttempts} ao criar PR retornou status ${response.status}; ` +
                `nova tentativa em ${delayMs}ms (${message})`,
            );
            await this.sleep(delayMs);
            continue;
          }

          throw new Error(
            `Falha ao criar PR: ${response.status} ${message}${
              permissionHint ? ` (${permissionHint})` : ''
            }`,
          );
        }

        return await response.json();
      } catch (error) {
        if (this.isRetryableNetworkError(error) && attempt < maxAttempts) {
          const delayMs = this.calculatePrRetryDelay(attempt);
          this.log(
            job,
            `tentativa ${attempt}/${maxAttempts} falhou ao chamar API do GitHub (${this.formatError(error)}); ` +
              `aguardando ${delayMs}ms antes de tentar novamente`,
          );
          await this.sleep(delayMs);
          continue;
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new Error('Falha ao criar PR após múltiplas tentativas');
  }

  private shouldRetryPullRequestStatus(status: number): boolean {
    if (!Number.isFinite(status)) {
      return false;
    }
    if (status === 429 || status === 408) {
      return true;
    }
    return status >= 500 && status < 600;
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = typeof (error as any)?.code === 'string' ? (error as any).code.toUpperCase() : undefined;
    if (code && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED', 'ENOTFOUND'].includes(code)) {
      return true;
    }
    const message = (error.message ?? '').toLowerCase();
    return (
      message.includes('fetch failed') ||
      message.includes('networkerror') ||
      message.includes('timed out') ||
      message.includes('socket hang up') ||
      message.includes('tls handshake timeout')
    );
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      const label = error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message ?? '';
      const fallback = label && label.trim().length > 0 ? label : error.toString();
      return this.truncate(fallback, 200);
    }
    return this.truncate(String(error), 200);
  }

  private calculatePrRetryDelay(attempt: number): number {
    const base = Math.max(0, this.prCreateRetryDelayMs);
    return base * Math.max(1, attempt);
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private permissionHintFromMessage(message: string): string | undefined {
    const normalized = message.toLowerCase();
    if (normalized.includes('permission denied') || normalized.includes('authentication failed')) {
      return 'verifique se o token tem escopos de push e pull_request';
    }
    return undefined;
  }

  private buildCallbackPayload(job: SandboxJob): SandboxJob {
    const { callbackSecret: _secret, ...rest } = job;
    const payload = { ...rest } as SandboxJob;
    const interactionCountCandidates = [
      payload.interactionCount,
      Number.isFinite(job.interactionSequence) ? job.interactionSequence : undefined,
      Array.isArray(job.interactions) ? job.interactions.length : undefined,
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    payload.interactionCount = interactionCountCandidates.length > 0
      ? Math.max(...interactionCountCandidates)
      : undefined;
    if (job.database) {
      const { password: _password, ...database } = job.database;
      payload.database = database;
    }
    return payload;
  }

  private async sendCallback(job: SandboxJob): Promise<void> {
    if (!job.callbackUrl) {
      return;
    }
    if (!this.fetchImpl) {
      this.log(job, 'callback configurado, mas fetch não está disponível no ambiente');
      return;
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (job.callbackSecret) {
      headers['X-Sandbox-Callback-Token'] = job.callbackSecret;
    }

    const payload = this.buildCallbackPayload(job);

    try {
      const response = await this.fetchImpl(job.callbackUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`status ${response.status}: ${this.truncate(bodyText, 400)}`);
      }
      this.log(job, `callback enviado para ${job.callbackUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(job, `falha ao enviar callback para ${job.callbackUrl}: ${message}`);
    }
  }

  private log(job: SandboxJob, message: string) {
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const localTimestamp = now.toLocaleString('pt-BR', {
      hour12: false,
      timeZone: 'America/Sao_Paulo',
    });
    const entry = `[${isoTimestamp}] ${message}`;
    job.logs.push(entry);
    console.info(`[${localTimestamp}] Sandbox job ${job.jobId}: ${message}`);
  }

  private async describePathStatus(target: string): Promise<string> {
    try {
      const stats = await fs.stat(target);
      if (stats.isDirectory()) {
        return 'diretório acessível';
      }
      return `existe mas não é diretório (mode=${stats.mode})`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `inacessível: ${message}`;
    }
  }

  private sanitizeRequestedPath(requested: string | undefined): string | undefined {
    if (!requested) {
      return undefined;
    }
    const trimmed = requested.trim();
    const withoutQuotes = trimmed.replace(/^['"`]+|['"`]+$/g, '');
    const withoutTrailingBraces = withoutQuotes.replace(/[}\]]+$/g, '');
    const sanitized = withoutTrailingBraces.trim();
    return sanitized.length > 0 ? sanitized : undefined;
  }

  private async assertDirectoryExists(cwd: string): Promise<void> {
    try {
      const stats = await fs.stat(cwd);
      if (!stats.isDirectory()) {
        throw new Error(`cwd não é um diretório: ${cwd}`);
      }
    } catch (err) {
      throw new Error(`cwd não encontrado: ${cwd}`);
    }
  }

  private extractCallId(item: { id?: string; call_id?: string }, index: number): string {
    const fallback = `call_${index}`;
    const rawId = item.call_id ?? item.id ?? fallback;
    if (typeof rawId === 'string' && rawId.trim().length > 0) {
      return rawId;
    }
    return fallback;
  }

  private normalizeFunctionCallOutputId(rawId: string | undefined, fallback: string): string {
    const base = rawId && rawId.length > 0 ? rawId : fallback;
    const sanitized = this.sanitizeId(base.replace(/^fco_/, ''));
    return sanitized.startsWith('fco_') ? sanitized : `fco_${sanitized}`;
  }

  private sanitizeId(id: string | undefined): string {
    if (!id) {
      return 'msg_default';
    }
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'msg_default';
  }

  private escapePathForShell(target: string): string {
    return `'${target.replace(/'/g, "'\''")}'`;
  }

  private buildPrTitle(summary?: string): string {
    const defaultTitle = 'Correção automática do AI Hub';
    const prefix = 'AI Hub: ';
    const maxLength = 256;

    if (!summary || summary.trim().length === 0) {
      return defaultTitle;
    }

    const availableForSummary = Math.max(1, maxLength - prefix.length);
    const truncatedSummary = this.truncateWithEllipsis(summary.trim(), availableForSummary);
    return `${prefix}${truncatedSummary}`;
  }

  private buildPrBody(summary: string | undefined, taskDescription: string): string {
    const sections = [
      'Correção automática gerada pelo sandbox do AI Hub.',
      taskDescription ? `\n**Descrição da tarefa:**\n${taskDescription}` : undefined,
      summary ? `\n**Resumo das alterações:**\n${summary}` : undefined,
    ].filter(Boolean);

    return sections.join('\n');
  }

  private truncateWithEllipsis(value: string, maxLength: number): string {
    if (!value || maxLength <= 0) {
      return '';
    }
    if (value.length <= maxLength) {
      return value;
    }
    if (maxLength === 1) {
      return value.slice(0, maxLength);
    }
    return `${value.slice(0, maxLength - 1)}…`;
  }

  private truncate(value: string, maxLength = 200): string {
    if (!value) {
      return '';
    }
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
  }

  private logJson(job: SandboxJob, prefix: string, payload: unknown, maxLength = 2000) {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch (err) {
      serialized = `erro ao serializar payload: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.log(job, `${prefix}: ${this.truncate(serialized, maxLength)}`);
  }

  private sanitizeTaskDescription(description: string, job: SandboxJob): string {
    const limit = this.resolveTaskDescriptionLimit(job);
    const sanitizedDescription = description ?? '';
    const { value, truncated, omitted } = this.truncateStringValue(sanitizedDescription, limit);
    if (truncated) {
      this.log(
        job,
        `taskDescription com ${sanitizedDescription.length} caracteres truncado para ${limit} para evitar erro de contexto (omitiu ${omitted} caracteres)`,
      );
    }
    return value;
  }

  private prepareToolOutput(result: unknown, job: SandboxJob): string {
    const stringLimit = this.resolveToolOutputStringLimit(job);
    const serializedLimit = this.resolveToolOutputSerializedLimit(job);
    const truncation = { truncated: false };
    const sanitized = this.truncateStringFields(result, stringLimit, truncation);
    let serialized: string;

    try {
      serialized = JSON.stringify(sanitized);
    } catch (err) {
      serialized = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    if (truncation.truncated) {
      this.log(
        job,
        `output de tool truncado para ${stringLimit} caracteres por campo para evitar ultrapassar a janela de contexto`,
      );
    }

    const { value, truncated, omitted } = this.truncateStringValue(serialized, serializedLimit);
    if (truncated) {
      this.log(
        job,
        `output serializado da tool excedeu ${serializedLimit} caracteres e foi truncado (omitiu ${omitted} caracteres)`
      );
    }
    return value;
  }

  private resolveModel(job: SandboxJob): string {
    const candidate = typeof job.model === 'string' ? job.model.trim() : '';
    if (candidate) {
      return candidate;
    }
    if ((this.isEconomy(job) || this.isSmartEconomy(job) || this.isEcoOne(job) || this.isEcoTwo(job) || this.isEcoThree(job) || this.isChatgptCodexFamily(job)) && this.economyModel) {
      return this.economyModel;
    }
    return this.model;
  }

  private isEconomy(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'ECONOMY';
  }

  private isEcoOne(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'ECO_1';
  }

  private isEcoTwo(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'ECO_2';
  }

  private isEcoThree(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'ECO_3';
  }

  private isSmartEconomy(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'SMART_ECONOMY';
  }

  private isChatgptCodex(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'CHATGPT_CODEX';
  }

  private isChatgptCodexMarketing(job: SandboxJob): boolean {
    return (job.profile ?? 'STANDARD') === 'CHATGPT_CODEX_MKT';
  }

  private isChatgptCodexFamily(job: SandboxJob): boolean {
    return this.isChatgptCodex(job) || this.isChatgptCodexMarketing(job);
  }

  private resolveTaskDescriptionLimit(job: SandboxJob): number {
    if (this.isEconomy(job)) {
      return this.economyMaxTaskDescriptionChars;
    }
    if (this.isSmartEconomy(job)) {
      return this.smartEconomyMaxTaskDescriptionChars;
    }
    if (this.isEcoOne(job)) {
      return this.ecoOneMaxTaskDescriptionChars;
    }
    if (this.isChatgptCodexFamily(job)) {
      return this.chatgptCodexMaxTaskDescriptionChars;
    }
    return this.maxTaskDescriptionChars;
  }

  private resolveToolOutputStringLimit(job: SandboxJob): number {
    if (this.isEconomy(job)) {
      return this.economyToolOutputStringLimit;
    }
    if (this.isSmartEconomy(job)) {
      return this.smartEconomyToolOutputStringLimit;
    }
    if (this.isEcoTwo(job)) {
      return this.ecoTwoToolOutputStringLimit;
    }
    if (this.isEcoThree(job)) {
      return this.ecoThreeToolOutputStringLimit;
    }
    if (this.isEcoOne(job)) {
      return this.ecoOneToolOutputStringLimit;
    }
    if (this.isChatgptCodexFamily(job)) {
      return this.chatgptCodexToolOutputStringLimit;
    }
    return this.toolOutputStringLimit;
  }

  private resolveToolOutputSerializedLimit(job: SandboxJob): number {
    if (this.isEconomy(job)) {
      return this.economyToolOutputSerializedLimit;
    }
    if (this.isSmartEconomy(job)) {
      return this.smartEconomyToolOutputSerializedLimit;
    }
    if (this.isEcoTwo(job)) {
      return this.ecoTwoToolOutputSerializedLimit;
    }
    if (this.isEcoThree(job)) {
      return this.ecoThreeToolOutputSerializedLimit;
    }
    if (this.isEcoOne(job)) {
      return this.ecoOneToolOutputSerializedLimit;
    }
    if (this.isChatgptCodexFamily(job)) {
      return this.chatgptCodexToolOutputSerializedLimit;
    }
    return this.toolOutputSerializedLimit;
  }

  private resolveHttpToolMaxResponseChars(job: SandboxJob): number {
    if (this.isEconomy(job)) {
      return this.economyHttpToolMaxResponseChars;
    }
    if (this.isSmartEconomy(job)) {
      return this.smartEconomyHttpToolMaxResponseChars;
    }
    if (this.isEcoTwo(job)) {
      return this.ecoTwoHttpToolMaxResponseChars;
    }
    if (this.isEcoThree(job)) {
      return this.ecoThreeHttpToolMaxResponseChars;
    }
    if (this.isEcoOne(job)) {
      return this.ecoOneHttpToolMaxResponseChars;
    }
    if (this.isChatgptCodexFamily(job)) {
      return this.chatgptCodexHttpToolMaxResponseChars;
    }
    return this.httpToolMaxResponseChars;
  }

  private applyEcoPreSamplingCompaction(job: SandboxJob, messages: ResponseItem[]): void {
    const profile = this.resolveEcoProfile(job);
    if (!profile) {
      return;
    }
    const trimmedHistory = this.pruneEcoHistory(job, messages, profile.historyTargetTokens, profile.label);
    const trimmedUsers = this.enforceEcoUserMessageBudget(
      job,
      messages,
      profile.userMessageTokenLimit,
      profile.label,
    );
    if (trimmedHistory || trimmedUsers) {
      this.log(
        job,
        `Modo ${profile.label}: histórico compactado preventivamente antes da próxima iteração.`,
      );
    }
  }

  private enforceEcoUserMessageBudget(
    job: SandboxJob,
    messages: ResponseItem[],
    limit: number,
    label: string,
  ): boolean {
    if (!Array.isArray(messages) || messages.length === 0) {
      return false;
    }
    const normalizedLimit = Math.max(0, limit);
    let remaining = normalizedLimit;
    let preservedUserMessages = 0;
    let changed = false;

    for (let index = messages.length - 1; index >= 0; index--) {
      const item = messages[index];
      if (!item || item.type !== 'message') {
        continue;
      }
      const message = item as ResponseOutputMessage;
      const role = (message as { role?: string }).role ?? 'assistant';
      if (role !== 'user') {
        continue;
      }

      const textValue = this.collectMessageTexts(message.content);
      const tokens = this.approximateTokensFromText(textValue);
      if (tokens <= remaining) {
        remaining = Math.max(0, remaining - tokens);
        preservedUserMessages++;
        continue;
      }

      if (remaining > 0) {
        const truncated = this.truncateTextByTokenBudget(textValue, remaining);
        const note = `\n\n[Modo ${label}: ${truncated.omittedTokens} tokens omitidos do histórico do usuário]`;
        message.content = [{ type: 'output_text', text: `${truncated.value}${note}` }] as ResponseOutputMessage['content'];
        remaining = 0;
        preservedUserMessages++;
        changed = true;
        this.log(job, `Modo ${label}: mensagem de usuário truncada para manter o limite configurado.`);
        continue;
      }

      if (preservedUserMessages === 0 && normalizedLimit > 0) {
        const fallbackTokens = Math.max(1, Math.floor(normalizedLimit * 0.1));
        const truncated = this.truncateTextByTokenBudget(textValue, fallbackTokens);
        const note = `\n\n[Modo ${label}: ${truncated.omittedTokens} tokens omitidos para preservar contexto do usuário]`;
        message.content = [{ type: 'output_text', text: `${truncated.value}${note}` }] as ResponseOutputMessage['content'];
        preservedUserMessages++;
        changed = true;
        this.log(job, `Modo ${label}: mensagem de usuário preservada com resumo mínimo.`);
      } else {
        messages.splice(index, 1);
        changed = true;
        this.log(job, `Modo ${label}: mensagem de usuário antiga removida para respeitar o limite do histórico.`);
      }
    }

    return changed;
  }

  private enforceEcoAutoCompaction(job: SandboxJob, messages: ResponseItem[]): void {
    const profile = this.resolveEcoProfile(job);
    if (!profile) {
      return;
    }
    const totalTokens = job.totalTokens ?? 0;
    if (totalTokens <= 0) {
      return;
    }
    const autoCompactLimit = Math.max(0, profile.autoCompactTokenLimit);
    if (autoCompactLimit === 0 || totalTokens < autoCompactLimit) {
      return;
    }
    const target = Math.min(profile.historyTargetTokens, Math.floor(autoCompactLimit * 0.9));
    if (target <= 0) {
      return;
    }
    if (this.pruneEcoHistory(job, messages, target, profile.label)) {
      this.log(
        job,
        `Modo ${profile.label}: auto-compactação executada após atingir ${totalTokens} tokens (alvo ${target}).`,
      );
    }
  }

  private pruneEcoHistory(
    job: SandboxJob,
    messages: ResponseItem[],
    targetTokens: number,
    label: string,
  ): boolean {
    if (!Array.isArray(messages) || messages.length === 0 || !Number.isFinite(targetTokens) || targetTokens <= 0) {
      return false;
    }
    let estimated = this.estimateMessagesTokenFootprint(messages);
    if (estimated <= targetTokens) {
      return false;
    }
    let removed = 0;

    for (let index = messages.length - 1; index >= 0 && estimated > targetTokens; index--) {
      const item = messages[index];
      if (!this.isRemovableHistoryItem(item)) {
        break;
      }
      const footprint = this.estimateItemTokenFootprint(item);
      messages.splice(index, 1);
      estimated = Math.max(0, estimated - footprint);
      removed++;
    }

    if (removed > 0) {
      this.log(job, `Modo ${label}: removidos ${removed} item(ns) do histórico para manter ${targetTokens} tokens.`);
      return true;
    }
    return false;
  }

  private resolveEcoProfile(job: SandboxJob): {
    label: string;
    autoCompactTokenLimit: number;
    historyTargetTokens: number;
    userMessageTokenLimit: number;
  } | undefined {
    if (this.isEcoTwo(job)) {
      return {
        label: 'ECO-2',
        autoCompactTokenLimit: this.ecoTwoAutoCompactTokenLimit,
        historyTargetTokens: this.ecoTwoHistoryTargetTokens,
        userMessageTokenLimit: this.ecoTwoUserMessageTokenLimit,
      };
    }
    if (this.isEcoThree(job)) {
      return {
        label: 'ECO-3',
        autoCompactTokenLimit: this.ecoThreeAutoCompactTokenLimit,
        historyTargetTokens: this.ecoThreeHistoryTargetTokens,
        userMessageTokenLimit: this.ecoThreeUserMessageTokenLimit,
      };
    }
    return undefined;
  }

  private enforceEcoThreeGuardrails(job: SandboxJob, turnCount: number): void {
    if (!this.isEcoThree(job)) {
      return;
    }
    if (this.ecoThreeMaxTurns > 0 && turnCount > this.ecoThreeMaxTurns) {
      throw new Error(
        `Modo ECO-3 interrompeu a execução após ${turnCount} iterações para evitar ultrapassar o limite de ${this.ecoThreeMaxTurns} turnos. Resuma o estado atual e encerre a tarefa manualmente.`,
      );
    }
    const totalTokens = job.totalTokens ?? 0;
    if (this.ecoThreeMaxTotalTokens > 0 && totalTokens >= this.ecoThreeMaxTotalTokens) {
      throw new Error(
        `Modo ECO-3 atingiu ${totalTokens} tokens (limite ${this.ecoThreeMaxTotalTokens}) e encerrou automaticamente para conter custos. Gere um resumo e finalize o fluxo manualmente.`,
      );
    }
  }

  private isRemovableHistoryItem(item: ResponseItem | undefined): boolean {
    if (!item) {
      return false;
    }
    if (item.type === 'function_call' || item.type === 'function_call_output') {
      return true;
    }
    if (this.isReasoningItem(item)) {
      return true;
    }
    if (item.type === 'message') {
      const message = item as ResponseOutputMessage;
      const role = (message as { role?: string }).role ?? 'assistant';
      return role === 'assistant';
    }
    return false;
  }

  private estimateMessagesTokenFootprint(messages: ResponseItem[]): number {
    if (!Array.isArray(messages) || messages.length === 0) {
      return 0;
    }
    return messages.reduce((total, item) => total + this.estimateItemTokenFootprint(item), 0);
  }

  private estimateItemTokenFootprint(item: ResponseItem | undefined): number {
    if (!item) {
      return 0;
    }
    if (item.type === 'message') {
      const message = item as ResponseOutputMessage;
      return this.approximateTokensFromText(this.collectMessageTexts(message.content));
    }
    if (item.type === 'function_call') {
      const call = item as ResponseFunctionToolCallItem;
      return this.approximateTokensFromText(this.safeStringify({
        name: call.name ?? 'tool_call',
        arguments: call.arguments ?? {},
      }));
    }
    if (item.type === 'function_call_output') {
      const output = item as ResponseFunctionToolCallOutputItem;
      return this.approximateTokensFromText(
        typeof output.output === 'string' ? output.output : this.safeStringify(output.output ?? {}),
      );
    }
    if (this.isReasoningItem(item)) {
      const reasoning = item as unknown as ResponseReasoningItem;
      const summaryText = Array.isArray(reasoning.summary)
        ? reasoning.summary.map((part) => part.text).join('\n')
        : '';
      return this.approximateTokensFromText(summaryText);
    }
    return this.approximateTokensFromText(this.safeStringify(item));
  }

  private approximateTokensFromText(value: string | undefined): number {
    if (!value) {
      return 0;
    }
    return Math.max(1, Math.ceil(value.length / Math.max(1, this.ecoTwoCharsPerTokenEstimate)));
  }

  private truncateTextByTokenBudget(
    text: string,
    tokenBudget: number,
  ): { value: string; truncated: boolean; omittedTokens: number } {
    if (!text) {
      return { value: '', truncated: false, omittedTokens: 0 };
    }
    const safeBudget = Math.max(1, Math.floor(tokenBudget));
    const estimated = this.approximateTokensFromText(text);
    if (estimated <= safeBudget) {
      return { value: text, truncated: false, omittedTokens: 0 };
    }
    const charBudget = Math.max(1, safeBudget * this.ecoTwoCharsPerTokenEstimate);
    const trimmed = `${text.slice(0, Math.max(0, charBudget - 1))}…`;
    const omittedTokens = Math.max(0, estimated - safeBudget);
    return { value: trimmed, truncated: true, omittedTokens };
  }

  private truncateStringFields(value: unknown, maxLength: number, tracker: { truncated: boolean }): unknown {
    if (typeof value === 'string') {
      const truncated = this.truncateStringValue(value, maxLength);
      tracker.truncated = tracker.truncated || truncated.truncated;
      return truncated.value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.truncateStringFields(item, maxLength, tracker));
    }

    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.truncateStringFields(val, maxLength, tracker);
      }
      return result;
    }

    return value;
  }

  private truncateStringValue(value: string, maxLength: number): { value: string; truncated: boolean; omitted: number } {
    if (!Number.isFinite(maxLength) || maxLength <= 0 || value.length <= maxLength) {
      return { value, truncated: false, omitted: 0 };
    }

    const suffixBase = '... [truncated ';
    const suffixClose = ' chars]';
    const suffixLength = suffixBase.length + suffixClose.length + String(value.length).length;
    const available = Math.max(0, maxLength - suffixLength);
    const omitted = Math.max(0, value.length - available);
    const suffix = `${suffixBase}${omitted}${suffixClose}`;
    const truncatedValue = `${value.slice(0, available)}${suffix}`;

    return { value: truncatedValue, truncated: true, omitted };
  }

  private buildPromptCacheKey(job: SandboxJob, model: string): string | undefined {
    const repo = (job.repoSlug ?? this.extractRepoName(job.repoUrl) ?? 'unknown').toLowerCase();
    const branch = (job.branch || 'unknown').toLowerCase();
    const profile = (job.profile ?? 'STANDARD').toUpperCase();
    const basePrefix = this.promptCacheKeyPrefix ? this.promptCacheKeyPrefix : 'ai-hub';
    const key = `${basePrefix}:${repo}:${branch}:${profile}:${model}`;
    return key.slice(0, 200);
  }

  private extractRepoName(repoUrl: string | undefined): string | undefined {
    if (!repoUrl) {
      return undefined;
    }
    const normalized = repoUrl.replace(/\/$/, '');
    const lastSegment = normalized.split('/').pop();
    if (!lastSegment) {
      return undefined;
    }
    return lastSegment.replace(/\.git$/i, '');
  }

  private parsePositiveInteger(raw: string | undefined, defaultValue: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }
  private parsePercentage(raw: string | undefined, fallback: number): number {
    const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    if (parsed <= 0) {
      return 0.01;
    }
    if (parsed >= 1) {
      return 1;
    }
    return parsed;
  }
}
