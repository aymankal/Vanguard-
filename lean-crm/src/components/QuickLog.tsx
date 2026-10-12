import { useEffect, useRef, useState } from 'react';
import { api, toast } from '../api';
import type { Activity, ActivityType } from '../types';

const ACTIONS: { type: ActivityType; label: string; key: string; tone: string }[] = [
  { type: 'call_connected', label: 'Connected', key: '1', tone: 'text-emerald-700 dark:text-emerald-300' },
  { type: 'call_no_answer', label: 'No answer', key: '2', tone: '' },
  { type: 'call_voicemail', label: 'Voicemail', key: '3', tone: '' },
  { type: 'email', label: 'Email', key: 'e', tone: '' },
  { type: 'linkedin', label: 'LinkedIn', key: 'l', tone: '' },
  { type: 'meeting_booked', label: 'Meeting booked', key: 'm', tone: 'text-indigo-700 dark:text-indigo-300' },
];
export const LOG_LABEL: Partial<Record<ActivityType, string>> = {
  call_connected: 'Call — connected', call_no_answer: 'Call — no answer', call_voicemail: 'Call — left voicemail',
  email: 'Email sent', linkedin: 'LinkedIn message', meeting_booked: 'Meeting booked',
};

/** Next weekday at 10:00, local, for <input type="datetime-local">. */
function nextSlot() {
  const d = new Date();
  do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T10:00`;
}
const isTyping = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;

/** One-click (or one-key) SDR activity logging. Optimistic, with Undo. */
export function QuickLog({ fk, onLogged, onChanged }: {
  fk: Record<string, number>;
  onLogged: (a: Activity) => void;
  onChanged: () => void;
}) {
  const [meeting, setMeeting] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  async function log(type: ActivityType, meeting_at?: string) {
    const temp: Activity = {
      id: -Date.now(), type, body: LOG_LABEL[type] ?? '', contact_id: null, company_id: null, deal_id: null,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), meeting_at: meeting_at?.replace('T', ' ') ?? null, meeting_status: type === 'meeting_booked' ? 'booked' : null,
    };
    onLogged(temp);
    try {
      const r = await api<{ id: number }>('/activities', { method: 'POST', body: { type, ...fk, ...(meeting_at ? { meeting_at } : {}) } });
      toast(`Logged: ${LOG_LABEL[type]}`, 'ok', {
        label: 'Undo',
        run: () => api(`/activities/${r.id}`, { method: 'DELETE' }).then(onChanged).catch((e) => toast(e.message, 'error')),
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    onChanged();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || meeting !== null) return;
      const a = ACTIONS.find((x) => x.key === e.key.toLowerCase());
      if (!a) return;
      e.preventDefault();
      if (a.type === 'meeting_booked') setMeeting(nextSlot());
      else log(a.type);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => { if (meeting !== null) dateRef.current?.focus(); }, [meeting !== null]);

  return (
    <div className="card p-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-xs font-medium text-zinc-500">Log</span>
        <span className="px-1 text-xs text-zinc-400">Call:</span>
        {ACTIONS.map((a, i) => (
          <span key={a.type} className="contents">
            {i === 3 && <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />}
            <button
              className={`btn py-1 text-xs ${a.tone}`}
              onClick={() => (a.type === 'meeting_booked' ? setMeeting(nextSlot()) : log(a.type))}
              title={`Shortcut: ${a.key}`}
            >
              {a.label} <span className="kbd">{a.key}</span>
            </button>
          </span>
        ))}
      </div>
      {meeting !== null && (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); log('meeting_booked', meeting); setMeeting(null); }}>
          <label className="text-xs text-zinc-500" htmlFor="meeting-at">Meeting on</label>
          <input id="meeting-at" ref={dateRef} type="datetime-local" className="input w-auto py-1" value={meeting} onChange={(e) => setMeeting(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setMeeting(null)} required />
          <button className="btn-primary py-1">Log meeting ↵</button>
          <button type="button" className="btn-ghost" onClick={() => setMeeting(null)}>Cancel</button>
        </form>
      )}
    </div>
  );
}
