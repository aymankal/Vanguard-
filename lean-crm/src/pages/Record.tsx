import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useQuery, write, toast, invalidateAll } from '../api';
import type { Activity, Company, Contact, Deal, Stage, Task } from '../types';
import { Editable } from '../components/Editable';
import { Markdown } from '../components/Markdown';
import { TaskRow } from '../components/TaskRow';
import { ResearchPanel, NextBestAction } from '../components/AiPanels';
import { QuickLog } from '../components/QuickLog';
import { useSession } from '../session';
import type { MeetingStatus } from '../types';
import { ago, fmtDate, money, todayStr, addDays } from '../format';

type Kind = 'contacts' | 'companies' | 'deals';
type RecordData = { contact?: Contact; company?: Company; deal?: Deal; contacts?: Contact[]; deals?: Deal[]; tasks: Task[]; activities: Activity[] };

export function RecordPage() {
  const { kind, id } = useParams() as { kind: Kind; id: string };
  const valid = ['contacts', 'companies', 'deals'].includes(kind);
  const { data, mutate, reload, error } = useQuery<RecordData>(valid ? `/${kind}/${id}` : null);
  const navigate = useNavigate();
  const { me } = useSession();

  if (!valid) return <p className="p-8 text-zinc-500">Page not found.</p>;
  if (error && !data) return <div className="p-8"><p className="text-red-600">{error}</p><Link className="text-sm text-indigo-600" to="/contacts">← Back</Link></div>;
  if (!data) return <div className="p-8 text-sm text-zinc-400">Loading…</div>;

  const rec = (data.contact ?? data.company ?? data.deal)!;
  const singular = kind === 'companies' ? 'company' : kind.slice(0, -1);
  const fk = { [`${singular}_id`]: Number(id) };

  const saveField = (key: string, value: unknown) => {
    const k = singular as 'contact' | 'company' | 'deal';
    const prev = (data[k] as unknown as Record<string, unknown>)[key];
    mutate((d) => ({ ...d, [k]: { ...d[k]!, [key]: value } }));
    write(api(`/${kind}/${id}`, { method: 'PATCH', body: { [key]: value } }), () => mutate((d) => ({ ...d, [k]: { ...d[k]!, [key]: prev } })))
      .then((r) => r && (key.endsWith('_id') || key === 'company') && reload());
  };

  const remove = async () => {
    const label = 'name' in rec ? rec.name : rec.title;
    if (!confirm(`Delete ${label}? This can't be undone.`)) return;
    await write(api(`/${kind}/${id}`, { method: 'DELETE' }));
    invalidateAll();
    navigate(kind === 'deals' ? '/pipeline' : kind === 'companies' ? '/contacts?tab=companies' : '/contacts');
  };

  const toggleTask = (t: Task) => {
    mutate((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: x.done ? 0 : 1 } : x)) }));
    write(api(`/tasks/${t.id}`, { method: 'PATCH', body: { done: !t.done } })).then(() => reload());
  };

  const timelineVersion = `${data.activities.length}:${data.activities[0]?.id ?? 0}:${data.tasks.filter((t) => !t.done).length}`;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
      <Header kind={kind} data={data} saveField={saveField} onDelete={remove} />

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="order-2 space-y-3 lg:order-1 lg:col-span-3">
          {me.agency && (
            <QuickLog fk={fk} onLogged={(a) => mutate((d) => ({ ...d, activities: [a, ...d.activities] }))} onChanged={reload} />
          )}
          <Composer fk={fk} onLogged={(a) => { mutate((d) => ({ ...d, activities: [a, ...d.activities] })); reload(); }} />
          <Timeline items={data.activities} showUser={me.agency} onMeeting={(a, status) => {
            mutate((d) => ({ ...d, activities: d.activities.map((x) => (x.id === a.id ? { ...x, meeting_status: status } : x)) }));
            write(api(`/activities/${a.id}`, { method: 'PATCH', body: { meeting_status: status } }));
          }} />
        </section>
        <aside className="order-1 space-y-4 lg:order-2 lg:col-span-2">
          <Details kind={kind} data={data} saveField={saveField} />
          <Related data={data} />
          <Tasks tasks={data.tasks} onToggle={toggleTask} fk={kind === 'companies' ? null : fk} contactId={data.deal?.contact_id ?? null} onAdded={reload} />
        </aside>
      </div>

      <section className="card p-4">
        {kind === 'deals' ? (
          <NextBestAction dealId={Number(id)} timelineVersion={timelineVersion} />
        ) : (
          <ResearchPanel kind={singular as 'company' | 'contact'} id={Number(id)} name={(rec as Contact | Company).name} />
        )}
      </section>
    </div>
  );
}

function Header({ kind, data, saveField, onDelete }: { kind: Kind; data: RecordData; saveField: (k: string, v: unknown) => void; onDelete: () => void }) {
  const back = kind === 'deals' ? { to: '/pipeline', label: 'Pipeline' } : { to: kind === 'companies' ? '/contacts?tab=companies' : '/contacts', label: kind === 'companies' ? 'Companies' : 'Contacts' };
  let title: string, sub: React.ReactNode;
  if (data.deal) {
    title = data.deal.title;
    sub = <>{money(data.deal.value)} · {data.deal.stage}{data.deal.company && <> · <Link className="hover:underline" to={`/companies/${data.deal.company_id}`}>{data.deal.company}</Link></>}</>;
  } else if (data.contact) {
    title = data.contact.name;
    sub = <>{data.contact.title}{data.contact.title && data.contact.company && ' at '}{data.contact.company && <Link className="hover:underline" to={`/companies/${data.contact.company_id}`}>{data.contact.company}</Link>}</>;
  } else {
    title = data.company!.name;
    sub = <>{[data.company!.industry, data.company!.size && `${data.company!.size} employees`].filter(Boolean).join(' · ')}</>;
  }
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Link to={back.to} className="text-xs text-zinc-500 hover:underline">← {back.label}</Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Editable value={title} onSave={(v) => saveField(data.deal ? 'title' : 'name', v)} className="text-2xl" />
        </h1>
        <p className="text-sm text-zinc-500">{sub}</p>
      </div>
      <button className="btn-ghost mt-5" onClick={onDelete}>Delete</button>
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2 py-1 text-sm">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Details({ kind, data, saveField }: { kind: Kind; data: RecordData; saveField: (k: string, v: unknown) => void }) {
  const companies = useQuery<Company[]>('/companies');
  const contacts = useQuery<Contact[]>(kind === 'deals' ? '/contacts' : null);
  const stages = useQuery<Stage[]>(kind === 'deals' ? '/stages' : null);

  return (
    <div className="card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Details</h2>
      {data.contact && (
        <>
          <Field label="Title"><Editable value={data.contact.title} onSave={(v) => saveField('title', v)} /></Field>
          <Field label="Company">
            <Editable value={data.contact.company} list="rec-company-names" onSave={(v) => saveField('company', v)} />
            <datalist id="rec-company-names">{companies.data?.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Email">
            <div className="flex items-center gap-1">
              <Editable value={data.contact.email} type="email" onSave={(v) => saveField('email', v)} />
              {data.contact.email && <a className="btn-ghost" href={`mailto:${data.contact.email}`} title="Send email">✉</a>}
            </div>
          </Field>
          <Field label="Phone">
            <div className="flex items-center gap-1">
              <Editable value={data.contact.phone} onSave={(v) => saveField('phone', v)} />
              {data.contact.phone && <a className="btn-ghost" href={`tel:${data.contact.phone}`} title="Call">☏</a>}
            </div>
          </Field>
          <Field label="Owner"><Editable value={data.contact.owner} onSave={(v) => saveField('owner', v)} /></Field>
          <Field label="Last touch"><span className="text-zinc-500">{ago(data.contact.last_activity)}</span></Field>
        </>
      )}
      {data.company && (
        <>
          <Field label="Website">
            <div className="flex items-center gap-1">
              <Editable value={data.company.website} onSave={(v) => saveField('website', v)} />
              {data.company.website && <a className="btn-ghost" href={/^https?:/.test(data.company.website) ? data.company.website : `https://${data.company.website}`} target="_blank" rel="noopener noreferrer">↗</a>}
            </div>
          </Field>
          <Field label="Industry"><Editable value={data.company.industry} onSave={(v) => saveField('industry', v)} /></Field>
          <Field label="Size"><Editable value={data.company.size} onSave={(v) => saveField('size', v)} placeholder="e.g. 51-200" /></Field>
          <Field label="Notes"><Editable value={data.company.notes} multiline onSave={(v) => saveField('notes', v)} /></Field>
        </>
      )}
      {data.deal && (
        <>
          <Field label="Value"><Editable value={data.deal.value} type="number" onSave={(v) => saveField('value', Number(v) || 0)} /></Field>
          <Field label="Stage">
            <select className="input py-1" value={data.deal.stage_id} onChange={(e) => saveField('stage_id', Number(e.target.value))}>
              {stages.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Company">
            <select className="input py-1" value={data.deal.company_id ?? ''} onChange={(e) => saveField('company_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Contact">
            <select className="input py-1" value={data.deal.contact_id ?? ''} onChange={(e) => saveField('contact_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {contacts.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Close date"><Editable value={data.deal.close_date} type="date" onSave={(v) => saveField('close_date', v || null)} /></Field>
        </>
      )}
    </div>
  );
}

function Related({ data }: { data: RecordData }) {
  const deals = data.deals ?? [];
  const contacts = data.contacts ?? [];
  if (!deals.length && !contacts.length) return null;
  return (
    <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">
      {!!contacts.length && (
        <div className="p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">People</h2>
          {contacts.map((c) => (
            <Link key={c.id} to={`/contacts/${c.id}`} className="flex justify-between rounded px-1 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span>{c.name}</span><span className="text-xs text-zinc-500">{c.title}</span>
            </Link>
          ))}
        </div>
      )}
      {!!deals.length && (
        <div className="p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Deals</h2>
          {deals.map((d) => (
            <Link key={d.id} to={`/deals/${d.id}`} className="flex justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="truncate">{d.title}</span><span className="shrink-0 text-xs text-zinc-500">{money(d.value)} · {d.stage}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Tasks({ tasks, onToggle, fk, contactId, onAdded }: { tasks: Task[]; onToggle: (t: Task) => void; fk: Record<string, number> | null; contactId: number | null; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(addDays(todayStr(), 1));
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const body = { title: title.trim(), due_date: due || null, ...fk, ...(fk?.deal_id && contactId ? { contact_id: contactId } : {}) };
    setTitle('');
    await write(api('/tasks', { method: 'POST', body }));
    onAdded();
  };
  return (
    <div className="card">
      <h2 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Tasks</h2>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {tasks.map((t) => <TaskRow key={t.id} task={t} onToggle={onToggle} showLinks={false} />)}
      </ul>
      {!tasks.length && <p className="px-4 py-2 text-sm text-zinc-400">No tasks.</p>}
      {fk && (
        <form onSubmit={add} className="flex gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <input className="input" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input w-36" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn" disabled={!title.trim()}>Add</button>
        </form>
      )}
    </div>
  );
}

function Composer({ fk, onLogged }: { fk: Record<string, number>; onLogged: (a: Activity) => void }) {
  const [body, setBody] = useState('');
  const [type, setType] = useState<'note' | 'email'>('note');
  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBody('');
    const temp: Activity = { id: -Date.now(), type, body: text, contact_id: null, company_id: null, deal_id: null, created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    onLogged(temp);
    const r = await write(api('/activities', { method: 'POST', body: { type, body: text, ...fk } }));
    if (r) toast(type === 'email' ? 'Email logged' : 'Note added');
  };
  return (
    <div className="card p-3">
      <textarea
        className="w-full resize-none bg-transparent text-sm"
        rows={2}
        placeholder={type === 'email' ? 'Paste or summarize the email…' : 'Add a note… (⌘↵ to save)'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex gap-1 text-xs">
          {(['note', 'email'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`rounded px-2 py-0.5 capitalize ${type === t ? 'bg-zinc-200 font-medium dark:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              {t === 'email' ? 'Log email' : 'Note'}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={submit} disabled={!body.trim()}>Save</button>
      </div>
    </div>
  );
}

const GREY = 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200';
const ICON: Record<Activity['type'], { icon: string; cls: string; label: string }> = {
  note: { icon: '✎', cls: GREY, label: 'Note' },
  email: { icon: '✉', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300', label: 'Email' },
  stage_change: { icon: '→', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300', label: 'Stage' },
  task_done: { icon: '✓', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300', label: 'Task' },
  call_connected: { icon: '☏', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300', label: 'Call' },
  call_no_answer: { icon: '☏', cls: GREY, label: 'Call' },
  call_voicemail: { icon: '☏', cls: GREY, label: 'Call' },
  linkedin: { icon: 'in', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300', label: 'LinkedIn' },
  meeting_booked: { icon: '★', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300', label: 'Meeting' },
};
const MEETING_STATUS: Record<MeetingStatus, string> = { booked: 'Booked', held: 'Held', no_show: 'No-show', cancelled: 'Cancelled' };
const fmtMeeting = (s: string) => new Date(s.replace(' ', 'T')).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Timeline({ items, showUser, onMeeting }: { items: Activity[]; showUser: boolean; onMeeting: (a: Activity, s: MeetingStatus) => void }) {
  if (!items.length) return <p className="px-1 text-sm text-zinc-400">No activity yet. Notes, emails, stage changes and completed tasks show up here.</p>;
  return (
    <ol className="relative space-y-3 pl-8 before:absolute before:top-2 before:bottom-2 before:left-3 before:w-px before:bg-zinc-200 dark:before:bg-zinc-800">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className={`absolute -left-8 grid h-6 w-6 place-items-center rounded-full text-xs ${ICON[a.type].cls}`}>{ICON[a.type].icon}</span>
          <div className="card px-3 py-2">
            <p className="mb-0.5 text-[11px] text-zinc-500">{ICON[a.type].label} · {fmtDate(a.created_at)}{showUser && a.user_name ? ` · ${a.user_name}` : ''}</p>
            {a.type === 'note' || a.type === 'email' ? <Markdown text={a.body} className="[&_p]:my-0.5" /> : <p className="text-sm">{a.body}</p>}
            {a.type === 'meeting_booked' && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {a.meeting_at && <span className="font-medium">{fmtMeeting(a.meeting_at)}</span>}
                <select className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700" value={a.meeting_status ?? 'booked'}
                  disabled={a.id < 0} onChange={(e) => onMeeting(a, e.target.value as MeetingStatus)} aria-label="Meeting status">
                  {Object.entries(MEETING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
