export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface SandboxJob {
  jobId: string;
  repoSlug?: string;
  repoUrl: string;
  branch: string;
  taskDescription: string;
  testCommand?: string;
  commitHash?: string;
  status: JobStatus;
  summary?: string;
  changedFiles?: string[];
  patch?: string;
  error?: string;
  sandboxPath?: string;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JobProcessor {
  process(job: SandboxJob): Promise<void>;
}
