export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface SandboxJob {
  jobId: string;
  repoUrl: string;
  branch: string;
  task: string;
  testCommand?: string;
  commitHash?: string;
  status: JobStatus;
  summary?: string;
  changedFiles?: string[];
  patch?: string;
  error?: string;
  sandboxPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobProcessor {
  process(job: SandboxJob): Promise<void>;
}
