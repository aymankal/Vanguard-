import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class ApiError extends Error {}

// Active client workspace (Agency Mode). Sent on every request; the server re-checks access.
let activeClient: number | null = null;
export const getActiveClient = () => activeClient;
export function setActiveClient(id: number | null) {
  if (id === activeClient) return;
  activeClient = id;
  cache.clear();
  invalidateAll();
}
let previewUser: number | null = null;
/** Hosted version only: the owner previews the app as another person. */
export function setPreviewUser(id: number | null) {
  previewUser = id;
  try { id ? sessionStorage.setItem('lc_preview', String(id)) : sessionStorage.removeItem('lc_preview'); } catch { /* storage blocked */ }
}
try { previewUser = Number(sessionStorage.getItem('lc_preview')) || null; } catch { /* storage blocked */ }
const headers = (json: boolean): Record<string, string> => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(activeClient ? { 'X-Client-Id': String(activeClient) } : {}),
  ...(previewUser ? { 'X-Preview-User': String(previewUser) } : {}),
});
/** Fired when the session expires so the app can show the sign-in page. */
const signedOut = () => window.dispatchEvent(new Event('lc:signed-out'));

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method: opts.method ?? 'GET',
      headers: headers(opts.body !== undefined),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the Lean CRM server. Is `npm run dev` running?");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'auth') signedOut();
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`);
  return data as T;
}

/** POST and read a Server-Sent Events stream of JSON messages. */
export async function stream(url: string, body: unknown, onEvent: (e: Record<string, any>) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method: 'POST', headers: headers(true), body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) return;
    throw new ApiError("Can't reach the Lean CRM server. Is `npm run dev` running?");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === 'auth') signedOut();
    throw new ApiError(data.error || `Request failed (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith('data: ')) onEvent(JSON.parse(chunk.slice(6)));
    }
  }
}

// ---------- Tiny query cache: instant revisits, background refresh, global invalidation ----------
const cache = new Map<string, unknown>();
const key = (url: string) => `${activeClient ?? 0}|${url}`;
const reloaders = new Set<() => void>();
export const invalidateAll = () => reloaders.forEach((r) => r());

export function useQuery<T>(url: string | null) {
  const [data, setData] = useState<T | undefined>(() => (url ? (cache.get(key(url)) as T) : undefined));
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const k = key(u);
      const d = await api<T>(u);
      cache.set(k, d);
      if (urlRef.current === u) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setData(url ? (cache.get(key(url)) as T) : undefined);
    reload();
  }, [url, reload]);

  useEffect(() => {
    reloaders.add(reload);
    return () => void reloaders.delete(reload);
  }, [reload]);

  /** Optimistic local update (also updates the cache). */
  const mutate = useCallback((fn: (d: T) => T) => {
    setData((d) => {
      if (d === undefined) return d;
      const next = fn(d);
      if (urlRef.current) cache.set(key(urlRef.current), next);
      return next;
    });
  }, []);

  return { data, error, reload, mutate };
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; kind: 'error' | 'ok'; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) {
  const t: Toast = { id: Date.now() + Math.random(), text, kind, action };
  toasts = [...toasts, t];
  toastSubs.forEach((s) => s());
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== t);
    toastSubs.forEach((s) => s());
  }, kind === 'error' ? 6000 : action ? 5000 : 2500);
}
export function dismissToast(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  toastSubs.forEach((s) => s());
}
export const useToasts = () =>
  useSyncExternalStore((cb) => (toastSubs.add(cb), () => void toastSubs.delete(cb)), () => toasts);

/** Run a write; on failure show the error, revert via onError, and resync. */
export async function write<T>(p: Promise<T>, onError?: () => void): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    toast((e as Error).message, 'error');
    onError?.();
    invalidateAll();
  }
}
