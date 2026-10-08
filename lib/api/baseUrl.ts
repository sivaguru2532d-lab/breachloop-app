/**
 * Dynamic API URL resolver.
 *
 * Rules, in order:
 *  1. `NEXT_PUBLIC_API_BASE_URL` wins when set (split hosting, staging API, etc).
 *  2. On Vercel (`*.vercel.app`) or any non-local host → relative `/api`. The UI
 *     and the route handlers are the same origin there, so there is nothing to
 *     point at, no CORS preflight, and no port to get wrong.
 *  3. In local dev on the Next port itself → relative `/api`.
 *  4. In local dev when the page is served from a *different* port (a static
 *     preview on 4173, an older Vite-style server) → `http://host:PORT/api`,
 *     using `NEXT_PUBLIC_BACKEND_PORT` (default 3000).
 *
 * The old client hard-coded `/api` against a Vite proxy that forwarded to
 * `127.0.0.1:8000`. Deploy that to Vercel and the proxy does not exist, so every
 * request 404'd into an HTML document — the origin of the "Backend unavailable"
 * state.
 */

const TRAILING_SLASH = /\/+$/;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export type ApiBaseSource = 'env' | 'vercel-or-prod' | 'same-origin-dev' | 'dev-port-fallback';

export interface ApiBase {
  base: string;
  source: ApiBaseSource;
  sameOrigin: boolean;
}

function normalize(url: string): string {
  const trimmed = url.trim().replace(TRAILING_SLASH, '');
  return trimmed === '' ? '/api' : trimmed;
}

export function resolveApiBase(): ApiBase {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured && configured.trim()) {
    const base = normalize(configured);
    return { base, source: 'env', sameOrigin: base.startsWith('/') };
  }

  if (typeof window === 'undefined') {
    // Server-side render / route handler: always relative.
    return { base: '/api', source: 'vercel-or-prod', sameOrigin: true };
  }

  const host = window.location.hostname;
  const isLocal = LOCAL_HOSTS.has(host);
  const isVercel = host.endsWith('.vercel.app') || host === 'vercel.app';

  if (isVercel || !isLocal) {
    return { base: '/api', source: 'vercel-or-prod', sameOrigin: true };
  }

  const apiPort = process.env.NEXT_PUBLIC_BACKEND_PORT ?? '3000';
  const pagePort = window.location.port;

  if (pagePort === apiPort || pagePort === '') {
    return { base: '/api', source: 'same-origin-dev', sameOrigin: true };
  }

  return {
    base: normalize(`${window.location.protocol}//${window.location.hostname}:${apiPort}/api`),
    source: 'dev-port-fallback',
    sameOrigin: false,
  };
}

export function apiUrl(path: string): string {
  const { base } = resolveApiBase();
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}

/** Small helper for the diagnostics line in the console header. */
export function describeApiBase(): string {
  const { base, source } = resolveApiBase();
  return `${base} (${source})`;
}
