import { useEffect, useRef, useState } from 'react';
import { api, stream, toast, invalidateAll } from '../api';
import { Markdown } from './Markdown';

type Source = { url: string; title: string };

export function ResearchPanel({ kind, id, name }: { kind: 'company' | 'contact'; id: number; name: string }) {
  const [text, setText] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { setText(''); setSources([]); setDone(false); setError(null); setSaved(false); }, [kind, id]);

  async function run() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setText(''); setSources([]); setError(null); setDone(false); setSaved(false);
    setRunning(true); setStatus('Starting research…');
    try {
      await stream('/ai/research', { kind, id }, (e) => {
        if (e.type === 'status') setStatus(e.text);
        else if (e.type === 'text') { setStatus(null); setText((t) => t + e.text); }
        else if (e.type === 'final') { setText(e.markdown); setSources(e.sources); setDone(true); }
        else if (e.type === 'error') setError(e.message);
      }, ctrl.signal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false); setStatus(null);
    }
  }

  async function save() {
    const body = `**AI research — ${name}**\n\n${text}${sources.length ? `\n\n**Sources**\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}` : ''}`;
    try {
      await api('/activities', { method: 'POST', body: { type: 'note', body, [`${kind}_id`]: id } });
      setSaved(true);
      toast('Saved to timeline');
      invalidateAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">✦ Research</h3>
          <p className="text-xs text-zinc-500">Web search: what they do, size, news, pain points, talking points and a first email.</p>
        </div>
        <div className="flex gap-2">
          {done && !saved && <button className="btn" onClick={save}>Save as note</button>}
          {saved && <span className="self-center text-xs text-emerald-600">Saved ✓</span>}
          {running ? (
            <button className="btn" onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <button className="btn-primary" onClick={run}>{done ? 'Run again' : 'Research'}</button>
          )}
        </div>
      </div>
      {status && <p className="mt-3 animate-pulse text-xs text-zinc-400">{status}</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</p>}
      {text && <Markdown text={text} className={`mt-3 ${running ? 'opacity-80' : ''}`} />}
      {!!sources.length && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sources</h4>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs">
            {sources.map((s) => (
              <li key={s.url}><a className="text-indigo-600 hover:underline dark:text-indigo-400" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> <span className="text-zinc-400">{new URL(s.url).hostname}</span></li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** One-line AI suggestion. Cached server-side; auto-refreshes once the timeline changes after a first request. */
export function NextBestAction({ dealId, timelineVersion }: { dealId: number; timelineVersion: string }) {
  const [text, setText] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force = false) {
    setLoading(true); setError(null);
    try {
      const r = await api<{ text: string }>(`/ai/nba/${dealId}${force ? '?force=1' : ''}`, { method: 'POST' });
      setText(r.text); setFresh(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let live = true;
    api<{ text: string | null; fresh: boolean }>(`/ai/nba/${dealId}`).then((r) => {
      if (!live) return;
      setText(r.text); setFresh(r.fresh);
      if (r.text && !r.fresh) generate(); // timeline changed since last suggestion
    }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, timelineVersion]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-semibold">✦ Next best action</span>
      <div className="min-w-0 flex-1 text-sm">
        {loading ? <span className="animate-pulse text-zinc-400">Thinking…</span>
          : error ? <span className="text-red-600 dark:text-red-400">{error}</span>
          : text ? <span className={fresh ? '' : 'text-zinc-400'}>{text}</span>
          : <span className="text-zinc-400">Get a one-line suggestion based on this deal's timeline.</span>}
      </div>
      <button className="btn" disabled={loading} onClick={() => generate(!!text)}>{text ? 'Refresh' : 'Suggest'}</button>
    </div>
  );
}
