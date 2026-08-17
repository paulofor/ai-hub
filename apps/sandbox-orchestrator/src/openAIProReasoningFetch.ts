type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];
type FetchResult = ReturnType<typeof globalThis.fetch>;

function resolveUrl(input: FetchInput): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function translateProReasoningBody(body: string): string | undefined {
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const model = typeof payload.model === 'string' ? payload.model.trim().toLowerCase() : '';
    const reasoning = payload.reasoning;
    if (!model.startsWith('gpt-5.6') || !reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) {
      return undefined;
    }

    const reasoningRecord = reasoning as Record<string, unknown>;
    if (reasoningRecord.effort !== 'pro') {
      return undefined;
    }

    payload.reasoning = {
      ...reasoningRecord,
      effort: 'high',
      mode: 'pro',
    };
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}

export function installOpenAIProReasoningFetchAdapter(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const adaptedFetch = ((input: FetchInput, init?: FetchInit): FetchResult => {
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const url = resolveUrl(input);
    if (!body || !url.includes('/responses')) {
      return fetchImpl(input, init);
    }

    const translatedBody = translateProReasoningBody(body);
    if (!translatedBody) {
      return fetchImpl(input, init);
    }

    return fetchImpl(input, {
      ...init,
      body: translatedBody,
    });
  }) as typeof globalThis.fetch;

  globalThis.fetch = adaptedFetch;
  return adaptedFetch;
}

export const openAIProReasoningFetchForTests = { translateProReasoningBody };
