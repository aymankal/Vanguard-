import { useState } from 'react';
import { api, useQuery, write, toast } from '../api';
import { useSession } from '../session';
import { Editable } from '../components/Editable';
import type { Client, Role } from '../types';
import { ask } from '../confirm';

type TeamUser = { id: number; email: string; name: string; role: Role; pending: boolean; client_ids: number[] };
type Person = { id: string; name: string; avatarUrl: string };

/** Hosted version: find a claude.ai account in your organization by name. */
function PersonPicker({ value, onChange }: { value: Person | null; onChange: (p: Person | null) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const find = async (text: string) => {
    setQ(text);
    setOpen(true);
    setHits(await api<Person[]>(`/agency/people?q=${encodeURIComponent(text)}`).catch(() => []));
  };
  if (value) {
    return (
      <span className="flex min-w-52 flex-1 items-center gap-2 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700">
        <img src={value.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
        <span className="flex-1 truncate">{value.name}</span>
        <button type="button" className="btn-ghost" onClick={() => onChange(null)} aria-label="Clear">✕</button>
      </span>
    );
  }
  return (
    <div className="relative min-w-52 flex-1">
      <input className="input" placeholder="Search people by name" value={q} onFocus={() => find(q)} onChange={(e) => find(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label="Search people" />
      {open && !!hits.length && (
        <ul className="absolute z-20 mt-1 w-full rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(p); setOpen(false); setQ(''); }}>
                <img src={p.avatarUrl} alt="" className="h-5 w-5 rounded-full" />{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shown in single-user mode. Turning Agency Mode on creates the owner login. */
export function EnableAgency() {
  const { me, reload } = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/auth/enable', { method: 'POST', body: f });
      await reload();
      toast('Agency Mode is on. Your current data is in “My workspace”.');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Agency Mode</h2>
          <p className="text-sm text-zinc-500">For outbound agencies running several clients: client workspaces, SDR logins, activity scores, weekly client reports and a client portal.</p>
        </div>
        <button role="switch" aria-checked={false} onClick={async () => {
          if (!me.hosted) return setOpen((o) => !o);
          if (!(await ask('Turn on Agency Mode? Your existing data moves into “My workspace”. People get access when you add their claude.ai email under Team.', 'Turn on'))) return;
          try { await api('/auth/enable', { method: 'POST', body: {} }); await reload(); } catch (err) { toast((err as Error).message, 'error'); }
        }} className="relative h-6 w-11 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-label="Turn on Agency Mode">
          <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow" />
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-4 space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-sm">Create your owner login. Everyone will need to sign in once Agency Mode is on. Your existing data moves into a workspace called “My workspace”.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="input" placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            <input className="input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
            <input className="input" type="password" placeholder="Password (8+)" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button className="btn-primary">Turn on Agency Mode</button>
        </form>
      )}
    </section>
  );
}

export function AgencySettings() {
  const { reload } = useSession();
  const settings = useQuery<{ timezone: string }>('/agency/settings');
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Beirut', 'UTC'];

  const disable = async () => {
    if (!(await ask('Turn off Agency Mode? Logins stop being required and only “My workspace” stays visible. Other client workspaces are kept and come back when you turn it on again.', 'Turn off'))) return;
    await write(api('/agency/disable', { method: 'POST' }));
    await reload();
  };
  return (
    <>
      <section className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Agency Mode</h2>
            <p className="text-sm text-zinc-500">On. Weekly reports are drafted every Monday at 08:00 for the previous week.</p>
          </div>
          <button role="switch" aria-checked onClick={disable} className="relative h-6 w-11 shrink-0 rounded-full bg-indigo-600" aria-label="Turn off Agency Mode">
            <span className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-white shadow" />
          </button>
        </div>
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Report timezone</span>
          <select className="input w-auto py-1" value={settings.data?.timezone ?? ''} onChange={(e) => {
            const tz = e.target.value;
            settings.mutate(() => ({ timezone: tz }));
            write(api('/agency/settings', { method: 'PATCH', body: { timezone: tz } })).then((r) => r && toast(`Reports now follow ${tz}`));
          }}>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
      </section>
      <Clients />
      <Team />
    </>
  );
}

function Clients() {
  const { reload } = useSession();
  const clients = useQuery<Client[]>('/agency/clients');
  const [name, setName] = useState('');
  const save = (c: Client, k: keyof Client, v: string) => {
    clients.mutate((l) => l.map((x) => (x.id === c.id ? { ...x, [k]: v } : x)));
    write(api(`/agency/clients/${c.id}`, { method: 'PATCH', body: { [k]: v } }), () => clients.reload()).then((r) => r && reload());
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const n = name.trim();
    setName('');
    await write(api('/agency/clients', { method: 'POST', body: { name: n } }));
    clients.reload();
    reload();
  };
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Clients</h2>
      <p className="mb-3 text-sm text-zinc-500">Each client is a separate workspace. Weekly reports go to the contact email.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 pr-2 font-medium">Name</th><th className="py-1 pr-2 font-medium">Contact email</th><th className="py-1 pr-2 font-medium">Start</th><th className="py-1 pr-2 font-medium">Status</th><th className="py-1 font-medium">Logo URL</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {clients.data?.map((c) => (
              <tr key={c.id}>
                <td className="min-w-36 py-1 pr-2"><Editable value={c.name} onSave={(v) => v.trim() && save(c, 'name', v)} /></td>
                <td className="min-w-48 py-1 pr-2"><Editable value={c.contact_email} type="email" onSave={(v) => save(c, 'contact_email', v)} placeholder="add email" /></td>
                <td className="min-w-32 py-1 pr-2"><Editable value={c.start_date} type="date" onSave={(v) => save(c, 'start_date', v)} /></td>
                <td className="py-1 pr-2">
                  <select className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700" value={c.status} onChange={(e) => save(c, 'status', e.target.value)} aria-label={`${c.name} status`}>
                    <option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
                  </select>
                </td>
                <td className="min-w-40 py-1"><Editable value={c.logo_url} onSave={(v) => save(c, 'logo_url', v)} placeholder="https://…" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input className="input" placeholder="New client name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()}>Add client</button>
      </form>
    </section>
  );
}

function Team() {
  const { me } = useSession();
  const users = useQuery<TeamUser[]>('/agency/users');
  const clients = useQuery<Client[]>('/agency/clients');
  const [f, setF] = useState<{ email: string; role: Role; client_ids: number[]; person?: Person | null }>({ email: '', role: 'rep', client_ids: [] });
  const [link, setLink] = useState<string | null>(null);
  const name = (id: number) => clients.data?.find((c) => c.id === id)?.name ?? `#${id}`;

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (me.hosted && !f.person) return toast('Pick a person from the search results.', 'error');
    const body = me.hosted ? { role: f.role, client_ids: f.client_ids, claude_id: f.person!.id, name: f.person!.name } : f;
    const r = await write(api<{ link?: string; emailed: boolean; hosted?: boolean }>('/agency/users/invite', { method: 'POST', body }));
    if (!r) return;
    toast(r.hosted ? `Added ${f.person?.name}. Share this page with them in claude.ai; they get access when they open it.`
      : r.emailed ? `Invite emailed to ${f.email}` : 'Invite created. Email isn’t set up, so copy the link below.');
    setLink(r.emailed || !r.link ? null : r.link);
    setF({ email: '', role: f.role, client_ids: [], person: null });
    users.reload();
  };
  const toggleAssign = (u: TeamUser, cid: number) => {
    const ids = u.client_ids.includes(cid) ? u.client_ids.filter((x) => x !== cid) : [...u.client_ids, cid];
    users.mutate((l) => l.map((x) => (x.id === u.id ? { ...x, client_ids: ids } : x)));
    write(api(`/agency/users/${u.id}`, { method: 'PATCH', body: { client_ids: ids } }), () => users.reload());
  };
  const remove = async (u: TeamUser) => {
    if (!(await ask(`Remove ${u.name || u.email}? They lose access immediately.`, 'Remove'))) return;
    users.mutate((l) => l.filter((x) => x.id !== u.id));
    write(api(`/agency/users/${u.id}`, { method: 'DELETE' }));
  };
  const roleLabel = { owner: 'Owner', rep: 'SDR', client: 'Client' };

  return (
    <section className="card p-4">
      <h2 className="font-semibold">Team and client logins</h2>
      <p className="mb-3 text-sm text-zinc-500">Owner sees everything. SDRs see the clients ticked for them. Client logins get a read-only portal.</p>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {users.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{u.name || u.email} {u.pending && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">invited</span>}</p>
              <p className="truncate text-xs text-zinc-500">{u.email.startsWith('claude:') ? 'claude.ai account' : u.email} · {roleLabel[u.role]}{u.role === 'client' ? ` · ${name(u.client_ids[0])}` : ''}</p>
            </div>
            {u.role === 'rep' && (
              <div className="flex flex-wrap gap-1">
                {clients.data?.map((c) => (
                  <button key={c.id} onClick={() => toggleAssign(u, c.id)} aria-pressed={u.client_ids.includes(c.id)}
                    className={`rounded-full border px-2 py-0.5 text-xs ${u.client_ids.includes(c.id) ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {u.id !== me.user?.id && <button className="btn-ghost" onClick={() => remove(u)} aria-label={`Remove ${u.email}`}>✕</button>}
          </li>
        ))}
      </ul>
      <form onSubmit={invite} className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-sm font-medium">{me.hosted ? 'Add a person' : 'Invite by email'}</p>
        <div className="flex flex-wrap gap-2">
          {me.hosted
            ? <PersonPicker value={f.person ?? null} onChange={(person) => setF({ ...f, person })} />
            : <input className="input min-w-52 flex-1" type="email" placeholder="name@company.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />}
          <select className="input w-auto" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role, client_ids: [] })} aria-label="Role">
            <option value="rep">SDR</option><option value="client">Client</option><option value="owner">Owner</option>
          </select>
          <button className="btn-primary">{me.hosted ? 'Add' : 'Send invite'}</button>
        </div>
        {f.role !== 'owner' && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-zinc-500">{f.role === 'client' ? 'Client:' : 'Clients:'}</span>
            {clients.data?.map((c) => {
              const on = f.client_ids.includes(c.id);
              return (
                <button type="button" key={c.id} aria-pressed={on}
                  onClick={() => setF({ ...f, client_ids: f.role === 'client' ? [c.id] : on ? f.client_ids.filter((x) => x !== c.id) : [...f.client_ids, c.id] })}
                  className={`rounded-full border px-2 py-0.5 ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'}`}>
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
        {link && (
          <div className="flex items-center gap-2 rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
            <code className="min-w-0 flex-1 truncate">{link}</code>
            <button type="button" className="btn py-0.5 text-xs" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'))}>Copy</button>
          </div>
        )}
      </form>
    </section>
  );
}
