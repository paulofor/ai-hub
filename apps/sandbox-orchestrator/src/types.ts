export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type SandboxProfile = 'STANDARD' | 'ECONOMY' | 'SMART_ECONOMY' | 'ECO_1' | 'ECO_2' | 'ECO_3' | 'CHATGPT_CODEX' | 'CHATGPT_CODEX_MKT';

export type InteractionDirection = 'OUTBOUND' | 'INBOUND';

export interface SandboxImageAttachment {
  name?: string;
  mimeType?: string;
  size?: number;
  dataUrl: string;
}

export interface SandboxDatabaseConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password?: string;
}

export interface SandboxInteraction {
  id: string;
  direction: InteractionDirection;
  content: string;
  tokenCount?: number;
  createdAt: string;
  sequence: number;
}

export interface SandboxHttpRequestLog {
  callId?: string;
  url: string;
  status?: number;
  success: boolean;
  toolName: string;
  requestedAt: string;
}

export interface SandboxJob {
  jobId: string;
  repoSlug?: string;
  repoUrl: string;
  branch: string;
  workBranch?: string;
  taskDescription: string;
  imageAttachments?: SandboxImageAttachment[];
  testCommand?: string;
  commitHash?: string;
  profile?: SandboxProfile;
  model?: string;
  accessToken?: string;
  githubToken?: string;
  callbackUrl?: string;
  callbackSecret?: string;
  status: JobStatus;
  summary?: string;
  interactions: SandboxInteraction[];
  interactionSequence: number;
  interactionCount?: number;
  changedFiles?: string[];
  patch?: string;
  pullRequestUrl?: string;
  error?: string;
  sandboxPath?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  database?: SandboxDatabaseConfig;
  logs: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  timeoutCount: number;
  httpGetCount?: number;
  httpGetSuccessCount?: number;
  dbQueryCount?: number;
  cancelRequested?: boolean;
  httpRequests?: SandboxHttpRequestLog[];
}

export interface JobProcessor {
  process(job: SandboxJob): Promise<void>;
}

export type CodexFunctionalErrorCode =
  | 'CODEX_APP_SERVER_UNAVAILABLE'
  | 'CODEX_NOT_AUTHENTICATED'
  | 'CODEX_MODEL_UNSUPPORTED'
  | 'CODEX_THREAD_START_FAILED'
  | 'CODEX_TURN_FAILED'
  | 'CODEX_TURN_INTERRUPTED'
  | 'CODEX_INPUT_IMAGE_UNSUPPORTED';

export interface CodexThreadStartResult {
  threadId: string;
}

export interface CodexTurnStartResult {
  turnId: string;
  threadId: string;
}

export interface CodexTurnCompletedEvent {
  turnId?: string;
  threadId?: string;
  status?: string;
  text?: string;
}
