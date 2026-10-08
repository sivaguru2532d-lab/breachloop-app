/**
 * Resilient fetch layer for the SOC console.
 *
 * Serverless functions cold-start, get recycled, and occasionally return a
 * transient 5xx while a new instance boots. The previous client did a single
 * `fetch` per call and turned any failure into a permanent blocking error state.
 *
 * This client:
 *  - retries up to `retries` extra attempts (default 3) with exponential backoff
 *    and jitter, so a cold start is absorbed silently,
 *  - treats a non-JSON body (an HTML error page from a misroute) as retryable,
 *  - never retries a 4xx — those are real answers, not infrastructure noise,
 *  - aborts via a deadline so a hung request cannot pin the UI in "Analyzing…",
 *  - distinguishes transient from terminal failures so the UI can keep
 *    auto-recovering in the background instead of locking the screen.
 */

import { apiUrl } from './baseUrl';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
    message: string,
    readonly attempts: number,
    readonly isTransient: boolean
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Extra attempts beyond the first; 0 disables retrying. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** `detail` is what FastAPI/Next error bodies use; fall back to the status text. */
function extractDetail(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['detail', 'error', 'message']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  if (typeof payload === 'string' && payload.trim()) {
    // An HTML error page must not be dumped into the UI.
    return payload.trim().startsWith('<') ? fallback : payload.trim().slice(0, 300);
  }
  return fallback;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    retries = 3,
    baseDelayMs = 250,
    maxDelayMs = 4000,
    timeoutMs = 20000,
    signal,
    onRetry,
  } = options;

  const url = apiUrl(path);
  const maxAttempts = Math.max(1, retries + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const relayAbort = () => controller.abort();
    signal?.addEventListener('abort', relayAbort, { once: true });

    let response: Response | undefined;
    let failure: { reason: string; transient: boolean; status: number; payload?: unknown } | undefined;

    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = {
        reason: (error as Error)?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (error as Error)?.message ?? 'network error',
        transient: true,
        status: 0,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relayAbort);
    }

    if (!failure && response) {
      const text = await response.text().catch(() => '');
      const looksJson = text.trim().startsWith('{') || text.trim().startsWith('[');

      if (response.ok && looksJson) {
        try {
          return JSON.parse(text) as T;
        } catch {
          failure = { reason: 'malformed JSON body', transient: true, status: response.status };
        }
      } else if (response.ok) {
        failure = { reason: 'API returned a non-JSON response', transient: true, status: response.status };
      } else {
        let payload: unknown = text;
        try {
          payload = JSON.parse(text);
        } catch {
          /* keep the raw text */
        }
        failure = {
          reason: `HTTP ${response.status}`,
          transient: RETRYABLE_STATUS.has(response.status),
          status: response.status,
          payload,
        };
      }
    }

    if (!failure) continue;

    lastError = failure;
    const canRetry = failure.transient && attempt < maxAttempts;
    if (canRetry) {
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(backoff / 2 + Math.random() * backoff);
      onRetry?.({ attempt, delayMs, reason: failure.reason });
      try {
        await sleep(delayMs, signal);
      } catch {
        break;
      }
      continue;
    }
    break;
  }

  const info = lastError as
    | { reason: string; transient: boolean; status: number; payload?: unknown }
    | undefined;
  throw new ApiError(
    info?.status ?? 0,
    info?.payload,
    extractDetail(info?.payload, info?.reason ?? 'request failed'),
    retries + 1,
    info?.transient ?? true
  );
}

/** GET that never throws — for background refreshes that must not break the UI. */
export async function requestSafe<T>(
  path: string,
  options: RequestOptions = {}
): Promise<{ data: T | null; error: ApiError | null }> {
  try {
    return { data: await request<T>(path, options), error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof ApiError
          ? error
          : new ApiError(0, null, (error as Error)?.message ?? 'request failed', 1, true),
    };
  }
}
