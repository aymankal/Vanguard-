import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, stream, invalidateAll, toast } from '../api';
import type { Action, Applied } from '../types';
import { Markdown } from './Markdown';
import { ClientLogo, useSwitchClient } from './ClientSwitcher';
import { useSession } from '../session';

type Turn = {
  role: 'user' | 'assistant';
  text: string;
  status?: string;
  error?: string;
  actions?: Action[];
  outcome?: 'pending' | 'saving' | 'saved' | 'discarded';
  applied?: Applied[];
  streaming?: boolean;
};

const EXAMPLES = [
  'Add Sara from Acme, $15k deal in Proposal, follow up Friday.',
  "What's closing this month?",
  "Who haven't I contacted in 2 weeks?",
  'Summarize Northwind Health',
];

const hrefFor = (a: Applied) => (a.kind === 'task' || a.kind === 'note' ? null : `/${a.kind === 'company' ? 'companies' : a.kind + 's'}/${a.id}`);

export function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { me, client } = useSession();
  const switchTo = useSwitchClient();
  const [hi, setHi] = useState(-1);

  // Agency Mode: typing a client name offers to switch workspaces (↓ then ↵, or "switch to <name>").
  const q = input.trim().toLowerCase().replace(/^(switch|go)( to)?\s+/, '');
  const clientMatches = me.agency
    ? [...(me.user?.role === 'owner' ? [{ id: 'all' as const, name: 'All clients', logo_url: '' }] : []), ...me.clients]
        .filter((c) => (q ? c.name.toLowerCase().includes(q) : !turns.length))
        .slice(0, 6)
    : [];
  const doSwitch = (id: number | 'all') => {
    switchTo(id);
    setInput('');
    setHi(-1);
    setTurns([]);
    onClose();
  };

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [turns]);

  const update = (i: number, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, j) => (j === i ? fn(t) : t)));

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    const history = [...turns, { role: 'user' as const, text }];
    const idx = history.length;
    setTurns([...history, { role: 'assistant', text: '', streaming: true, status: 'Thinking…' }]);

    // Send prior turns as plain text; note what happened to earlier proposals so follow-ups make sense.
    const messages = history
      .map((t) => ({
        role: t.role,
        content:
          t.text +
          (t.actions?.length
            ? `\n\n[Proposed: ${t.actions.map((a) => a.summary.replace(/\*\*/g, '')).join('; ')} — user ${t.outcome === 'saved' ? 'confirmed and saved these' : t.outcome === 'discarded' ? 'discarded these' : 'has not confirmed yet'}]`
            : ''),
      }))
      .filter((m) => m.content.trim());

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await stream(
        '/ai/chat',
        { messages },
        (e) => {
          if (e.type === 'text') update(idx, (t) => ({ ...t, text: t.text + e.text, status: undefined }));
          else if (e.type === 'status') update(idx, (t) => ({ ...t, status: e.text }));
          else if (e.type === 'proposal') update(idx, (t) => ({ ...t, actions: [...(t.actions ?? []), e.action], outcome: 'pending' }));
          else if (e.type === 'error') update(idx, (t) => ({ ...t, error: e.message }));
        },
        ctrl.signal,
      );
    } catch (e) {
      update(idx, (t) => ({ ...t, error: (e as Error).message }));
    } finally {
      update(idx, (t) => ({ ...t, streaming: false, status: undefined }));
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function confirm(i: number) {
    const t = turns[i];
    if (!t.actions?.length) return;
    update(i, (x) => ({ ...x, outcome: 'saving' }));
    try {
      const r = await api<{ applied: Applied[] }>('/ai/apply', { method: 'POST', body: { actions: t.actions.map(({ tool, input }) => ({ tool, input })) } });
      update(i, (x) => ({ ...x, outcome: 'saved', applied: r.applied }));
      invalidateAll();
      toast(`Saved ${r.applied.length} change${r.applied.length === 1 ? '' : 's'}`);
    } catch (e) {
      update(i, (x) => ({ ...x, outcome: 'pending' }));
      toast((e as Error).message, 'error');
    }
  }

  const removeAction = (i: number, k: number) =>
    update(i, (t) => {
      const actions = t.actions!.filter((_, j) => j !== k);
      return { ...t, actions, outcome: actions.length ? t.outcome : 'discarded' };
    });

  const pendingIdx = turns.findLastIndex((t) => t.outcome === 'pending' && !t.streaming);

  function onKeyDown(e: React.KeyboardEvent) {
    if (clientMatches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHi((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, clientMatches.length - 1) : Math.max(h - 1, -1)));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && hi >= 0 && clientMatches[hi]) {
      e.preventDefault();
      doSwitch(clientMatches[hi].id);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && /^(switch|go)\b/i.test(input.trim()) && clientMatches.length === 1) {
      e.preventDefault();
      doSwitch(clientMatches[0].id);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && pendingIdx >= 0) {
      e.preventDefault();
      confirm(pendingIdx);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/40 p-0 backdrop-blur-sm sm:p-4 sm:pt-[10vh]" onMouseDown={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[75vh] sm:rounded-xl sm:border sm:border-zinc-200 dark:bg-zinc-900 dark:sm:border-zinc-800"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command bar"
      >
        <div className="flex items-start gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <span className="mt-1.5 text-indigo-500">✦</span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => { setInput(e.target.value); setHi(-1); }}
            onKeyDown={onKeyDown}
            placeholder={me.agency ? `Ask or command in ${client?.name ?? 'this client'}, or type a client name…` : 'Tell me what to add, or ask about your pipeline…'}
            className="max-h-32 min-h-[2rem] flex-1 resize-none bg-transparent py-1 text-base"
          />
          {busy ? (
            <button className="btn-ghost mt-0.5" onClick={() => abortRef.current?.abort()}>Stop</button>
          ) : (
            <button className="btn-ghost mt-0.5 sm:hidden" onClick={onClose}>Close</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!!clientMatches.length && (
            <div className="mb-3 space-y-0.5" role="listbox" aria-label="Switch client">
              <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Switch client <span className="font-normal normal-case">↓ ↵</span></p>
              {clientMatches.map((c, i) => (
                <button key={c.id} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onClick={() => doSwitch(c.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === hi ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                  {c.id === 'all' ? <span className="grid h-5 w-5 place-items-center rounded bg-indigo-600 text-[10px] text-white">∗</span> : <ClientLogo client={c} size={5} />}
                  {c.name}
                  {c.id === client?.id && <span className="ml-auto text-xs text-zinc-400">current</span>}
                </button>
              ))}
            </div>
          )}
          {!turns.length && !q && (
            <div className="space-y-1">
              <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Try</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => send(ex)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  {ex}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-3">
            {turns.map((t, i) =>
              t.role === 'user' ? (
                <div key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white">{t.text}</div>
              ) : (
                <div key={i} className="space-y-2">
                  {t.text && <Markdown text={t.text} />}
                  {t.status && <p className="animate-pulse text-xs text-zinc-400">{t.status}</p>}
                  {t.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{t.error}</p>}
                  {!!t.actions?.length && (
                    <div className="card overflow-hidden">
                      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <span>{t.outcome === 'saved' ? 'Saved' : t.outcome === 'discarded' ? 'Discarded' : 'Confirm changes'}</span>
                        <span>{t.actions.length} change{t.actions.length > 1 ? 's' : ''}</span>
                      </div>
                      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {t.actions.map((a, k) => (
                          <li key={k} className="flex items-start gap-2 px-3 py-2">
                            <span className={t.outcome === 'saved' ? 'text-emerald-500' : 'text-zinc-400'}>{t.outcome === 'saved' ? '✓' : '+'}</span>
                            <Markdown text={a.summary} className="flex-1 [&_p]:my-0" />
                            {t.outcome === 'pending' && (
                              <button className="btn-ghost" onClick={() => removeAction(i, k)} aria-label="Remove change">✕</button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {(t.outcome === 'pending' || t.outcome === 'saving') && !t.streaming && (
                        <div className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                          <button className="btn-primary" disabled={t.outcome === 'saving'} onClick={() => confirm(i)} autoFocus>
                            {t.outcome === 'saving' ? 'Saving…' : 'Confirm'} <span className="text-[10px] opacity-70">⌘↵</span>
                          </button>
                          <button className="btn" onClick={() => update(i, (x) => ({ ...x, outcome: 'discarded' }))}>Discard</button>
                        </div>
                      )}
                      {t.outcome === 'saved' && !!t.applied?.length && (
                        <div className="flex flex-wrap gap-2 border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                          {t.applied.map((a, k) => {
                            const href = hrefFor(a);
                            return href ? (
                              <Link key={k} to={href} onClick={onClose} className="text-indigo-600 hover:underline dark:text-indigo-400">Open {a.label} →</Link>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
          <div ref={endRef} />
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800">
          <span><span className="kbd">↵</span> send · <span className="kbd">⇧↵</span> new line · <span className="kbd">esc</span> close</span>
          {!!turns.length && !busy && <button className="btn-ghost" onClick={() => setTurns([])}>Clear</button>}
        </div>
      </div>
    </div>
  );
}
