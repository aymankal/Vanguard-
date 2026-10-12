// The Lean CRM server, running inside the page. fetch('/api/...') is answered here, so the React app
// works unchanged. Every request runs against in-browser SQLite; changes are then flushed to the store.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from './shims/express';
import { api, errorHandler } from '../server/api.js';
import { agency, portalRoutes } from '../server/agency.js';
import { runDueReports } from '../server/reports.js';
import { seedIfEmpty } from '../server/seed.js';
import { db, agencyMode } from '../server/db.js';
import { ai } from './ai';
import { auth, attachScope, allowRoles, people } from './auth';
import { caps, viewer } from './caps';
import { installTriggers, connect, flush } from './sync';

const requireAgency = (req: any, res: any, next: () => void) =>
  req.scope.agency ? next() : res.status(404).json({ error: 'Agency Mode is off.' });

const app = Router();
app.use('/api/auth', auth);
app.use('/api', attachScope);
app.use('/api/agency/people', requireAgency, allowRoles('owner'), people);
app.use('/api/agency', requireAgency, allowRoles('owner'), agency);
app.use('/api/portal', requireAgency, allowRoles('client', 'owner'), portalRoutes);
app.use('/api/ai', allowRoles('owner', 'rep'), ai);
app.use('/api', allowRoles('owner', 'rep'), api);
app.use('/api', (_req: any, res: any) => res.status(404).json({ error: 'Not found.' }));
app.use('/api', errorHandler);

const enc = new TextEncoder();

/** Handle one request with Express-like req/res objects and return a real Response. */
function dispatch(method: string, url: URL, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  return new Promise((resolve) => {
    let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    const closeFns: (() => void)[] = [];
    const res: any = {
      statusCode: 200, headers: {} as Record<string, string>, headersSent: false, writableEnded: false,
      status(c: number) { this.statusCode = c; return this; },
      setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; },
      type(t: string) { return this.setHeader('content-type', t); },
      on(ev: string, fn: () => void) { if (ev === 'close') closeFns.push(fn); return this; },
      writeHead(code: number, h: Record<string, string> = {}) {
        this.statusCode = code;
        Object.entries(h).forEach(([k, v]) => this.setHeader(k, v));
        this.headersSent = true;
        resolve(new Response(new ReadableStream({ start: (c) => { stream = c; } }), { status: code, headers: this.headers }));
        return this;
      },
      write(chunk: string | Uint8Array) {
        if (!this.headersSent) this.writeHead(this.statusCode);
        stream?.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk);
        return true;
      },
      end(chunk?: string | Uint8Array) {
        if (this.writableEnded) return;
        this.writableEnded = true;
        if (this.headersSent) {
          if (chunk) stream?.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk);
          stream?.close();
        } else {
          this.headersSent = true;
          resolve(new Response(chunk ?? null, { status: this.statusCode, headers: this.headers }));
        }
        settle();
      },
      json(o: unknown) { this.setHeader('content-type', 'application/json'); this.end(JSON.stringify(o)); },
      send(b: unknown) { this.end(b instanceof Uint8Array ? b : typeof b === 'string' ? b : JSON.stringify(b)); },
    };
    signal?.addEventListener('abort', () => closeFns.forEach((f) => f()));
    const req: any = {
      method, url: url.pathname + url.search, path: url.pathname, body, headers, params: {},
      query: Object.fromEntries(url.searchParams), protocol: 'https', secure: true,
      get: (h: string) => headers[h.toLowerCase()],
    };
    const settle = () => { if (method !== 'GET' || url.pathname.startsWith('/api/auth/me') || url.pathname.startsWith('/api/agency/overview')) flush(); };
    app(req, res, (err?: unknown) => {
      if (!res.writableEnded) res.status(err ? 500 : 404).json({ error: err ? 'Something went wrong.' : 'Not found.' });
    });
  });
}

export function installFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (!(raw.startsWith('/api/') || (url.origin === location.origin && url.pathname.startsWith('/api/')))) return real(input, init);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    // Let the UI paint before running the query.
    await Promise.resolve();
    return dispatch((init.method ?? 'GET').toUpperCase(), url, headers, body, init.signal ?? undefined);
  };
}

/** Links to /api files (PDF, export) and generated CSVs become claude.ai downloads. */
export function installDownloads(toast: (m: string, kind?: 'error' | 'ok') => void) {
  const save = async (blob: Blob, filename: string) => {
    if (!caps.downloads) return toast('Downloads aren’t available in this view.', 'error');
    try { await caps.downloads.save({ filename, data: blob }); }
    catch (e: any) { if (e?.code !== 'cancelled' && e?.code !== 'declined') toast('The file couldn’t be saved.', 'error'); }
  };
  const nameFrom = (res: Response, fallback: string) =>
    /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  document.addEventListener('click', async (e) => {
    const a = (e.target as HTMLElement).closest?.('a[href^="/api/"]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const res = await fetch(a.getAttribute('href')!);
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? 'Download failed.', 'error');
    const href = a.getAttribute('href')!;
    await save(await res.blob(), nameFrom(res, href.includes('/pdf') ? 'weekly-report.pdf' : 'lean-crm-export.json'));
  }, true);
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download && this.href.startsWith('blob:')) {
      fetch(this.href).then((r) => r.blob()).then((b) => save(b, this.download));
      return;
    }
    return click.call(this);
  };
}

/** Load the shared store into SQLite and start syncing. */
export async function boot(handlers: { error: (m: string) => void; remote: () => void }) {
  // Hosted logins are claude.ai accounts: remember each person's account id.
  db.exec('ALTER TABLE users ADD COLUMN claude_id TEXT');
  installTriggers();
  if (caps.db) await connect(caps.db, handlers);
  // Brand-new page: create stages and the sample workspace (only someone who can write does this).
  if ((db.prepare('SELECT COUNT(*) n FROM stages').get() as { n: number }).n === 0 && (viewer.canEdit || viewer.isOwner)) seedIfEmpty();
  await flush();
  // Weekly reports are drafted when the owner opens the page on or after Monday 08:00.
  if (agencyMode() && viewer.isOwner && caps.sample) {
    runDueReports().then((made) => { if (made.length) { flush(); handlers.remote(); } }).catch(() => {});
  }
}
