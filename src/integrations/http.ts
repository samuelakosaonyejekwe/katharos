// Network helpers: timeouts, retries with backoff, and gateway failover (primary → backup).
import { settings } from '../core/settings';

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string = '',
  ) {
    super(message);
  }
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), init.timeoutMs ?? 15000);
  const outer = init.signal;
  outer?.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET/POST with retries on network errors, 429 and 5xx. */
export async function fetchRetry(url: string, init: RequestInit & { timeoutMs?: number } = {}, retries = 2): Promise<Response> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, init);
      if (res.status === 429 || res.status >= 500) {
        last = new HttpError(`HTTP ${res.status}`, res.status, await res.text().catch(() => ''));
      } else return res;
    } catch (e) {
      last = e;
    }
    if (i < retries) await sleep(600 * 2 ** i + Math.random() * 300);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function gatewayConfigured(): boolean {
  return Boolean(settings().gatewayUrl && settings().gatewayToken);
}

/** Calls the firm's gateway; on network failure or 5xx it fails over to the backup gateway. */
export async function gateway<T>(path: string, body?: unknown, opts: { timeoutMs?: number; method?: string } = {}): Promise<T> {
  const s = settings();
  const bases = [s.gatewayUrl, s.gatewayBackupUrl].filter(Boolean).map((u) => u.replace(/\/+$/, ''));
  if (!bases.length || !s.gatewayToken) throw new Error('Gateway not configured — open Integrations to connect it.');
  let lastErr: unknown;
  for (const base of bases) {
    try {
      const res = await fetchRetry(
        `${base}${path}`,
        {
          method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
          headers: { authorization: `Bearer ${s.gatewayToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          timeoutMs: opts.timeoutMs ?? 120000,
          mode: 'cors',
          credentials: 'omit',
        },
        1,
      );
      const text = await res.text();
      if (!res.ok) throw new HttpError(`Gateway ${path}: HTTP ${res.status}`, res.status, text);
      return (text ? JSON.parse(text) : {}) as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e; // client errors do not fail over
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Gateway unreachable');
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
