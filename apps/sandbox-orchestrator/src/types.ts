export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type SandboxProfile = 'STANDARD' | 'ECONOMY';

export type InteractionDirection = 'OUTBOUND' | 'INBOUND';

export interface SandboxInteraction {
  id: string;
  direction: InteractionDirection;
  content: string;
  tokenCount?: number;
  createdAt: string;
  sequence: number;
}

export interface SandboxJob {
  jobId: string;
  repoSlug?: string;
  repoUrl: string;
  branch: string;
  taskDescription: string;
  testCommand?: string;
  commitHash?: string;
  profile?: SandboxProfile;
  model?: string;
  status: JobStatus;
  summary?: string;
  interactions: SandboxInteraction[];
  interactionSequence: number;
  changedFiles?: string[];
  patch?: string;
  pullRequestUrl?: string;
  error?: string;
  sandboxPath?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  logs: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  timeoutCount: number;
  httpGetCount?: number;
  dbQueryCount?: number;
  cancelRequested?: boolean;
}

export interface JobProcessor {
  process(job: SandboxJob): Promise<void>;
}
