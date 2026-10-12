import { useState } from 'react';
import { api, useQuery, write, invalidateAll, toast } from '../api';
import type { Stage } from '../types';
import { Editable } from '../components/Editable';
import { useSession } from '../session';
import { AgencySettings, EnableAgency } from './AgencySettings';

type Status = { ok: boolean; model: string; message: string };

export function Settings() {
  const { me } = useSession();
  if (me.agency && me.user?.role === 'rep') return <RepSettings />;
  return <OwnerSettings />;
}

function RepSettings() {
  const { me } = useSession();
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <section className="card p-4 text-sm">
        <p className="font-semibold">{me.user?.name}</p>
        <p className="text-zinc-500">{me.user?.email} · SDR · {me.clients.map((c) => c.name).join(', ')}</p>
      </section>
      <Shortcuts />
    </div>
  );
}

function Shortcuts() {
  const { me } = useSession();
  return (
    <section className="space-y-1 text-xs text-zinc-400">
      <p><span className="kbd">⌘K</span> command bar{me.agency ? ' (type a client name to switch)' : ''} · <span className="kbd">g</span> then <span className="kbd">t</span>/<span className="kbd">p</span>/<span className="kbd">c</span>/<span className="kbd">s</span>{me.agency && me.user?.role === 'owner' ? <>/<span className="kbd">a</span></> : null} to navigate · <span className="kbd">/</span> search contacts</p>
      {me.agency && <p>On a contact, company or deal: <span className="kbd">1</span> connected · <span className="kbd">2</span> no answer · <span className="kbd">3</span> voicemail · <span className="kbd">e</span> email · <span className="kbd">l</span> LinkedIn · <span className="kbd">m</span> meeting booked</p>}
    </section>
  );
}

function OwnerSettings() {
  const { me } = useSession();
  const stages = useQuery<Stage[]>('/stages');
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [newStage, setNewStage] = useState('');

  const check = async () => {
    setChecking(true);
    try { setStatus(await api<Status>('/ai/status')); }
    catch (e) { setStatus({ ok: false, model: '', message: (e as Error).message }); }
    finally { setChecking(false); }
  };

  const move = (i: number, dir: -1 | 1) => {
    const list = [...(stages.data ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    stages.mutate(() => list);
    write(api('/stages/reorder', { method: 'POST', body: { ids: list.map((s) => s.id) } })).then(() => invalidateAll());
  };
  const rename = (s: Stage, name: string) => {
    stages.mutate((l) => l.map((x) => (x.id === s.id ? { ...x, name } : x)));
    write(api(`/stages/${s.id}`, { method: 'PATCH', body: { name } })).then(() => invalidateAll());
  };
  const remove = (s: Stage) => {
    stages.mutate((l) => l.filter((x) => x.id !== s.id));
    write(api(`/stages/${s.id}`, { method: 'DELETE' })).then((r) => r && toast(`Removed ${s.name}`));
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStage.trim()) return;
    const name = newStage.trim();
    setNewStage('');
    await write(api('/stages', { method: 'POST', body: { name } }));
    invalidateAll();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="card p-4">
        <h2 className="font-semibold">Pipeline stages</h2>
        <p className="mb-3 text-sm text-zinc-500">Click a name to rename. Stages named “Won” and “Lost” count as closed.{me.agency ? ' Shared by all clients.' : ''}</p>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {stages.data?.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 py-1.5">
              <span className="w-5 text-xs text-zinc-400">{i + 1}</span>
              <div className="flex-1"><Editable value={s.name} onSave={(v) => v.trim() && rename(s, v.trim())} /></div>
              <button className="btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="btn-ghost" onClick={() => move(i, 1)} disabled={i === stages.data!.length - 1} aria-label="Move down">↓</button>
              <button className="btn-ghost" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>✕</button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input className="input" placeholder="New stage name" value={newStage} onChange={(e) => setNewStage(e.target.value)} />
          <button className="btn" disabled={!newStage.trim()}>Add stage</button>
        </form>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">Claude API</h2>
        <p className="mb-3 text-sm text-zinc-500">
          The key lives in <code className="kbd">.env</code> as <code className="kbd">ANTHROPIC_API_KEY</code> and never reaches the browser.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check API key'}</button>
          {status && (
            <span className={`text-sm ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {status.ok ? '● ' : '○ '}{status.message}
            </span>
          )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">Your data</h2>
        <p className="mb-3 text-sm text-zinc-500">Everything{me.agency ? ' in the current client workspace' : ''} (companies, contacts, deals, tasks, timeline) as one JSON file. CSV export is on the Contacts page.</p>
        <a className="btn" href="/api/export" download>Download export</a>
      </section>

{me.agency ? <AgencySettings /> : <EnableAgency />}

      <Shortcuts />
    </div>
  );
}
