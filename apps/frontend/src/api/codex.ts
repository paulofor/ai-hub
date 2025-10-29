import client from './client';

export interface CodexSubmissionRequest {
  prompt: string;
  environment: string;
}

export interface CodexSubmissionResponse {
  id: number;
  environment: string;
  prompt: string;
  response: string | null;
  createdAt: string;
}

export async function submitCodexRequest(payload: CodexSubmissionRequest) {
  const { data } = await client.post<CodexSubmissionResponse>('/codex/requests', payload);
  return data;
}
