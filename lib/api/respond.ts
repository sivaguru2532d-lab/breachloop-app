/**
 * API response helpers shared by every route handler.
 *
 * Contract the handlers rely on:
 *  - Expected client mistakes (unknown scenario, malformed body) → 4xx, with a
 *    structured `detail` the console renders as a dismissible notice.
 *  - Anything unexpected → 200 + a valid fallback payload + `degraded: true`.
 *    The SOC console is never left holding an HTTP 500 with no data, which is
 *    exactly how the "Backend unavailable" lock-up was produced.
 */

import { NextResponse } from 'next/server';

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
} as const;

export interface ApiFailure {
  /** Marks a response that could not be served as requested. */
  error: string;
  detail: string;
  degraded?: boolean;
  degradation_notes?: string[];
}

/** Throw this to answer a 4xx instead of letting an error bubble to a 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string
  ) {
    super(detail);
    this.name = 'HttpError';
  }
}

export function ok<T extends object>(data: T, init?: ResponseInit): NextResponse {
  return new NextResponse(JSON.stringify(data), { status: 200, headers: JSON_HEADERS, ...init });
}

export function clientError(status: number, detail: string, extra?: Record<string, unknown>): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: status === 404 ? 'not_found' : 'bad_request', detail, ...extra }),
    { status, headers: JSON_HEADERS }
  );
}

/**
 * Wraps an async handler. The handler returns a real `NextResponse` (so 4xx
 * semantics stay intact); `fallback` is invoked with the caught error and returns
 * a JSON-serialisable body, answered with 200 + `degraded: true`.
 */
export async function resilient(
  route: string,
  handler: () => Promise<Response> | Response,
  fallback: (error: unknown) => object | Promise<object>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof HttpError) return clientError(error.status, error.detail);

    const message = error instanceof Error ? error.message : String(error);
    if (process.env.BREACHLOOP_DEBUG) {
      console.error(`[breachloop:${route}]`, error);
    } else {
      console.warn(`[breachloop:${route}] degraded response: ${message}`);
    }

    const body = await fallback(error);
    const record = body as Record<string, unknown>;
    const existing = Array.isArray(record['degradation_notes'])
      ? (record['degradation_notes'] as string[])
      : [];

    return ok({
      ...record,
      degraded: true,
      degradation_notes: [...existing, `${route} could not complete (${message}); served a generated fallback payload`],
    });
  }
}

/** Parses a JSON body without ever throwing on malformed input. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Accepts a scenario id from the path/body, sanitised for lookup only. */
export function sanitizeId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\/+|\/+$/g, '').replace(/\.json$/, '');
}
