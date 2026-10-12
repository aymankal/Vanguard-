import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery, write, toast, invalidateAll } from '../api';
import type { Deal, Task } from '../types';
import { TaskRow } from '../components/TaskRow';
import { ago, money, todayStr, addDays } from '../format';

type TodayData = { today: string; overdue: Task[]; due: Task[]; upcoming: Task[]; stale: Deal[] };

export function Today() {
  const { data, mutate, error } = useQuery<TodayData>('/today');
  const [newTask, setNewTask] = useState('');
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const dropTask = (id: number) => mutate((d) => ({ ...d, overdue: d.overdue.filter((t) => t.id !== id), due: d.due.filter((t) => t.id !== id), upcoming: d.upcoming.filter((t) => t.id !== id) }));
  const dropDeal = (id: number) => mutate((d) => ({ ...d, stale: d.stale.filter((x) => x.id !== id) }));

  const complete = (t: Task) => {
    dropTask(t.id);
    write(api(`/tasks/${t.id}`, { method: 'PATCH', body: { done: true } })).then((r) => r && toast('Done ✓'));
  };
  const snooze = (t: Task, date: string) => {
    dropTask(t.id);
    write(api(`/tasks/${t.id}`, { method: 'PATCH', body: { due_date: date } })).then(() => invalidateAll());
  };
  const followUp = (d: Deal) => {
    dropDeal(d.id);
    write(api('/tasks', { method: 'POST', body: { title: `Follow up: ${d.title}`, due_date: addDays(todayStr(), 1), deal_id: d.id, contact_id: d.contact_id } }))
      .then((r) => r && (toast('Follow-up set for tomorrow'), invalidateAll()));
  };
  const logTouch = (d: Deal) => {
    if (!note.trim()) return;
    dropDeal(d.id);
    setNoteFor(null);
    write(api('/activities', { method: 'POST', body: { type: 'note', body: note.trim(), deal_id: d.id } })).then((r) => r && toast('Logged'));
    setNote('');
  };
  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTask.trim();
    if (!title) return;
    setNewTask('');
    const temp: Task = { id: -Date.now(), title, due_date: todayStr(), contact_id: null, deal_id: null, done: 0 };
    mutate((d) => ({ ...d, due: [...d.due, temp] }));
    write(api('/tasks', { method: 'POST', body: { title, due_date: todayStr() } })).then(() => invalidateAll());
  };

  if (error && !data) return <p className="p-8 text-red-600">{error}</p>;
  if (!data) return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  const nothing = !data.overdue.length && !data.due.length && !data.stale.length;
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-sm text-zinc-500">{date}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data.overdue.length} overdue · {data.due.length} due today · {data.stale.length} deal{data.stale.length === 1 ? '' : 's'} going cold
        </p>
      </header>

      <form onSubmit={addTask} className="flex gap-2">
        <input className="input" placeholder="Add a task for today…" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
        <button className="btn" disabled={!newTask.trim()}>Add</button>
      </form>

      {nothing && <div className="card p-8 text-center text-sm text-zinc-500">All clear. Nothing overdue, nothing going cold. 🎯</div>}

      {!!data.overdue.length && (
        <Section title="Overdue" tone="red" count={data.overdue.length}>
          {data.overdue.map((t) => <TaskRow key={t.id} task={t} onToggle={complete} onSnooze={snooze} />)}
        </Section>
      )}
      {!!data.due.length && (
        <Section title="Due today" count={data.due.length}>
          {data.due.map((t) => <TaskRow key={t.id} task={t} onToggle={complete} onSnooze={snooze} />)}
        </Section>
      )}
      {!!data.stale.length && (
        <Section title="No activity in 7+ days" tone="amber" count={data.stale.length}>
          {data.stale.map((d) => (
            <li key={d.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <Link to={`/deals/${d.id}`} className="block truncate text-sm font-medium hover:underline">{d.title}</Link>
                  <p className="truncate text-xs text-zinc-500">{d.stage} · {money(d.value)}{d.contact ? ` · ${d.contact}` : ''} · last touch {ago(d.last_activity)}</p>
                </div>
                <div className="-ml-1.5 flex gap-1 sm:ml-0">
                  <button className="btn-ghost" onClick={() => { setNoteFor(noteFor === d.id ? null : d.id); setNote(''); }}>Log touch</button>
                  <button className="btn-ghost" onClick={() => followUp(d)}>Follow up tomorrow</button>
                </div>
              </div>
              {noteFor === d.id && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); logTouch(d); }}>
                  <input autoFocus className="input" placeholder="What happened? e.g. Called, left voicemail" value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setNoteFor(null)} />
                  <button className="btn-primary" disabled={!note.trim()}>Log</button>
                </form>
              )}
            </li>
          ))}
        </Section>
      )}
      {!!data.upcoming.length && (
        <Section title="Next 7 days" count={data.upcoming.length} muted>
          {data.upcoming.map((t) => <TaskRow key={t.id} task={t} onToggle={complete} onSnooze={snooze} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, tone, muted, children }: { title: string; count: number; tone?: 'red' | 'amber'; muted?: boolean; children: React.ReactNode }) {
  const dot = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <section className={muted ? 'opacity-80' : ''}>
      <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{title}<span className="font-normal">{count}</span>
      </h2>
      <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">{children}</ul>
    </section>
  );
}
