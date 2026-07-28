import { SandboxJob } from './types.js';

export const DEFAULT_JOB_PATCH_RESPONSE_MAX_CHARS = 5_000_000;

function resolvePatchResponseMaxChars(): number {
  const configured = Number(process.env.SANDBOX_JOB_PATCH_RESPONSE_MAX_CHARS);
  return Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_JOB_PATCH_RESPONSE_MAX_CHARS;
}

/** Build the bounded, secret-free representation used by polling and callbacks. */
export function buildJobPayload(job: SandboxJob, patchLimit = resolvePatchResponseMaxChars()): SandboxJob {
  const {
    accessToken: _accessToken,
    githubToken: _githubToken,
    callbackSecret: _callbackSecret,
    imageAttachments: _imageAttachments,
    logs: _logs,
    downloadLogs: _downloadLogs,
    ...rest
  } = job;
  const payload = { ...rest } as SandboxJob;
  const patchLength = job.patch?.length ?? 0;
  if (patchLength > patchLimit) {
    payload.patch = undefined;
    payload.patchTruncated = true;
    payload.patchSize = patchLength;
  }

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
