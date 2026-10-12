import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, useQuery, toast, invalidateAll } from '../api';
import { useSwitchClient, ClientLogo } from '../components/ClientSwitcher';
import { Markdown } from '../components/Markdown';
import { ago, money } from '../format';

type Lb = { user_id: number; name: string; activities: number; calls: number; connected: number; connect_rate: number; meetings: number; score: number };
type RollupRow = { id: number; name: string; logo_url: string; status: string; open_deals: number; open_value: number; created_deals: number; created_value: number; activities_week: number; meetings_week: number; connect_rate_week: number; last_activity: string | null };
type Health = { client_id: number; name: string; flags: { kind: string; label: string }[]; suggestions: Record<string, string> | null };
type ReportItem = { id: number; client_id: number; client: string; week_start: string; week_end: string; status: 'draft' | 'sent'; sent_at: string | null };
type Overview = { period: 'day' | 'week'; rollup: { clients: RollupRow[]; totals: Omit<RollupRow, 'id' | 'name' | 'logo_url' | 'status' | 'last_activity' | 'connect_rate_week'> }; leaderboard: Lb[]; health: Health[]; reports: ReportItem[] };

const week = (a: string, b: string) => `${fmtDay(a)} – ${fmtDay(b)}`;
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function Agency() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="reports/:id" element={<ReportEditor />} />
    </Routes>
  );
}

function Dashboard() {
  const [period, setPeriod] = useState<'day' | 'week'>('week');
  const { data, error, mutate } = useQuery<Overview>(`/agency/overview?period=${period}`);
  const go = useSwitchClient();
  const navigate = useNavigate();
  const [tipError, setTipError] = useState('');
  const asked = useRef(false);

  // Fetch one-line AI suggestions for flags that don't have one yet (cached per day on the server).
  useEffect(() => {
    if (!data || asked.current || !data.health.some((h) => !h.suggestions)) return;
    asked.current = true;
    api<{ suggestions: Record<number, Record<string, string>> }>('/agency/health/suggest', { method: 'POST' })
      .then((r) => mutate((d) => ({ ...d, health: d.health.map((h) => ({ ...h, suggestions: r.suggestions[h.client_id] ?? h.suggestions })) })))
      .catch((e) => setTipError(e.message));
  }, [data, mutate]);

  if (error && !data) return <p className="p-8 text-red-600">{error}</p>;
  if (!data) return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  const drafts = data.reports.filter((r) => r.status === 'draft');
  const sent = data.reports.filter((r) => r.status === 'sent').slice(0, 6);
  const t = data.rollup.totals;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agency</h1>
          <p className="mt-1 text-sm text-zinc-500">All clients · {money(t.open_value)} open pipeline · {t.activities_week} activities and {t.meetings_week} meetings this week</p>
        </div>
        <Link to="/portal" className="btn text-xs">Preview client portal</Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <H2>Needs attention</H2>
          {!data.health.length ? (
            <p className="card p-4 text-sm text-zinc-500">All active clients look healthy.</p>
          ) : (
            <ul className="space-y-2">
              {data.health.map((h) => (
                <li key={h.client_id} className="card p-3">
                  <button className="flex items-center gap-2 text-sm font-semibold hover:underline" onClick={() => go(h.client_id)}>
                    <ClientLogo client={{ name: h.name, logo_url: '' }} size={5} />{h.name}
                  </button>
                  <ul className="mt-2 space-y-1.5">
                    {h.flags.map((f) => (
                      <li key={f.kind} className="text-sm">
                        <p className="flex items-center gap-1.5 text-red-700 dark:text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{f.label}</p>
                        <p className="pl-3 text-zinc-600 dark:text-zinc-300">
                          {h.suggestions?.[f.kind] ? <>✦ {h.suggestions[f.kind]}</> : tipError ? <span className="text-xs text-zinc-400">{tipError}</span> : <span className="animate-pulse text-xs text-zinc-400">✦ Thinking…</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <H2>Weekly reports</H2>
          <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            {drafts.map((r) => (
              <Link key={r.id} to={`/agency/reports/${r.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <span className="truncate"><span className="font-medium">{r.client}</span> <span className="text-zinc-500">· {week(r.week_start, r.week_end)}</span></span>
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">Review draft →</span>
              </Link>
            ))}
            {sent.map((r) => (
              <Link key={r.id} to={`/agency/reports/${r.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <span className="truncate">{r.client} <span className="text-zinc-500">· {week(r.week_start, r.week_end)}</span></span>
                <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">Sent</span>
              </Link>
            ))}
            {!data.reports.length && <p className="p-3 text-sm text-zinc-500">Drafts appear every Monday at 08:00 for the previous week.</p>}
          </div>
        </section>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <H2 className="mb-0">Rep leaderboard</H2>
          <div className="flex rounded-md bg-zinc-200/70 p-0.5 text-xs dark:bg-zinc-800">
            {(['day', 'week'] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`rounded px-2 py-0.5 font-medium ${period === p ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500'}`}>{p === 'day' ? 'Today' : 'This week'}</button>
            ))}
          </div>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Rep</th>
              <Th>Activities</Th><Th>Connect rate</Th><Th>Meetings</Th><Th>Score</Th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.leaderboard.map((r, i) => (
                <tr key={r.user_id}>
                  <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <Td>{r.activities}</Td>
                  <Td>{r.calls ? `${r.connect_rate}%` : '—'} <span className="text-xs text-zinc-400">{r.calls ? `(${r.connected}/${r.calls})` : ''}</span></Td>
                  <Td>{r.meetings}</Td>
                  <Td><span className="font-semibold">{r.score}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.leaderboard.length && <p className="p-3 text-sm text-zinc-500">No reps yet. Invite them in Settings.</p>}
        </div>
        <p className="mt-1 text-xs text-zinc-400">Score: call 1 · connected call 3 · email 1 · LinkedIn 1 · meeting booked 10</p>
      </section>

      <section>
        <H2>All clients <span className="font-normal normal-case text-zinc-400">read-only</span></H2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Client</th><Th>Open pipeline</Th><Th>New this week</Th><Th>Activities (wk)</Th><Th>Meetings (wk)</Th><Th>Last activity</Th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.rollup.clients.map((c) => (
                <tr key={c.id} className={`cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${c.status !== 'active' ? 'opacity-60' : ''}`} onClick={() => { go(c.id); navigate('/pipeline'); }}>
                  <td className="px-3 py-2"><span className="flex items-center gap-2 font-medium"><ClientLogo client={c} size={5} />{c.name}{c.status !== 'active' && <span className="text-[10px] uppercase text-zinc-400">{c.status}</span>}</span></td>
                  <Td>{money(c.open_value)} <span className="text-xs text-zinc-400">({c.open_deals})</span></Td>
                  <Td>{money(c.created_value)} <span className="text-xs text-zinc-400">({c.created_deals})</span></Td>
                  <Td>{c.activities_week}</Td>
                  <Td>{c.meetings_week}</Td>
                  <Td><span className="text-zinc-500">{ago(c.last_activity)}</span></Td>
                </tr>
              ))}
              <tr className="bg-zinc-50 font-semibold dark:bg-zinc-800/40">
                <td className="px-3 py-2">Total</td>
                <Td>{money(t.open_value)}</Td><Td>{money(t.created_value)}</Td><Td>{t.activities_week}</Td><Td>{t.meetings_week}</Td><Td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const H2 = ({ children, className = 'mb-2' }: { children: React.ReactNode; className?: string }) =>
  <h2 className={`text-xs font-semibold uppercase tracking-wide text-zinc-500 ${className}`}>{children}</h2>;
const Th = ({ children }: { children: React.ReactNode }) => <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{children}</th>;
const Td = ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{children}</td>;

// ---------- Report editor ----------
type Metrics = { week_start: string; week_end: string; calls: number; connected: number; connect_rate: number; emails: number; linkedin: number; meetings: number; pipeline_deals: number; pipeline_value: number; wins: string[]; timezone: string };
type Report = { id: number; client: string; client_id: number; contact_email: string; week_start: string; week_end: string; metrics_json: string; summary: string; blockers: string; plan: string; ai_note: string; status: 'draft' | 'sent'; sent_at: string | null; sent_to: string | null };

export function ReportBody({ m, summary, blockers, plan }: { m: Metrics; summary: string; blockers: string; plan: string }) {
  return (
    <div className="space-y-4">
      <StatGrid m={m} />
      <Block title="Summary"><Markdown text={summary} /></Block>
      <Block title="Top wins">{m.wins.length ? <Markdown text={m.wins.map((w) => `- ${w}`).join('\n')} /> : <p className="text-sm text-zinc-500">No wins logged this week.</p>}</Block>
      <Block title="Blockers"><Markdown text={blockers || 'None.'} /></Block>
      <Block title="Plan for next week"><Markdown text={plan || '—'} /></Block>
    </div>
  );
}
export function StatGrid({ m }: { m: Metrics }) {
  const stats: [string, string][] = [
    ['Calls made', String(m.calls)], ['Connect rate', `${m.connect_rate}%`], ['Emails sent', String(m.emails)],
    ['Meetings booked', String(m.meetings)], ['New pipeline', money(m.pipeline_value)], ['New deals', String(m.pipeline_deals)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {stats.map(([l, v]) => (
        <div key={l} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <p className="text-lg font-semibold tabular-nums">{v}</p>
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{l}</p>
        </div>
      ))}
    </div>
  );
}
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><h3 className="mb-1 text-sm font-semibold">{title}</h3>{children}</div>
);

function ReportEditor() {
  const { id } = useParams() as { id: string };
  const { data: r, mutate, reload } = useQuery<Report>(`/agency/reports/${id}`);
  const [sending, setSending] = useState(false);
  if (!r) return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  const m = JSON.parse(r.metrics_json) as Metrics;
  const draft = r.status === 'draft';

  const save = (k: 'summary' | 'blockers' | 'plan', v: string) => {
    if (v === r[k]) return;
    mutate((x) => ({ ...x, [k]: v }));
    api(`/agency/reports/${id}`, { method: 'PATCH', body: { [k]: v } }).catch((e) => { toast(e.message, 'error'); reload(); });
  };
  const send = async () => {
    if (!confirm(`Send this report to ${r.contact_email || '(no contact email)'}?`)) return;
    setSending(true);
    try {
      const out = await api<{ delivered: boolean; file?: string; to: string }>(`/agency/reports/${id}/send`, { method: 'POST' });
      toast(out.delivered ? `Sent to ${out.to}` : `Saved to the portal. Email written to ${out.file?.split('/data/')[1] ?? 'data/outbox'} (SMTP not set up).`);
      reload();
      invalidateAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <Link to="/agency" className="text-xs text-zinc-500 hover:underline">← Agency</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{r.client}</h1>
          <p className="text-sm text-zinc-500">Weekly report · {week(m.week_start, m.week_end)} · {draft ? 'Draft' : `Sent ${r.sent_at?.slice(0, 10)} to ${r.sent_to}`}</p>
        </div>
        <div className="flex gap-2">
          <a className="btn" href={`/api/agency/reports/${id}/pdf`} target="_blank" rel="noopener">PDF</a>
          {draft && <button className="btn-primary" onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>}
        </div>
      </header>
      {r.ai_note && <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{r.ai_note}</p>}
      <div className="card space-y-4 p-4">
        <p className="text-xs text-zinc-500">Numbers and wins come straight from the CRM and can't be edited. {draft ? 'Edit the text, then Send.' : ''}</p>
        {draft ? (
          <>
            <StatGrid m={m} />
            <Edit label="Summary" value={r.summary} rows={5} onSave={(v) => save('summary', v)} />
            <Block title="Top wins">{m.wins.length ? <Markdown text={m.wins.map((w) => `- ${w}`).join('\n')} /> : <p className="text-sm text-zinc-500">No wins logged this week.</p>}</Block>
            <Edit label="Blockers" value={r.blockers} rows={4} onSave={(v) => save('blockers', v)} />
            <Edit label="Plan for next week" value={r.plan} rows={4} onSave={(v) => save('plan', v)} />
          </>
        ) : (
          <ReportBody m={m} summary={r.summary} blockers={r.blockers} plan={r.plan} />
        )}
      </div>
    </div>
  );
}

function Edit({ label, value, rows, onSave }: { label: string; value: string; rows: number; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <textarea className="input font-normal leading-relaxed" rows={rows} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} />
    </label>
  );
}
