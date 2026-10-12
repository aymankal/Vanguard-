import { useQuery } from '../api';
import { useSession } from '../session';
import { ClientLogo } from '../components/ClientSwitcher';
import { ReportBody } from './Agency';
import { money, ago } from '../format';

type Deal = { title: string; value: number; stage: string; company: string | null; created_at: string };
type PortalData = {
  client: { id: number; name: string; logo_url: string };
  pipeline: { week: { count: number; value: number; deals: Deal[] }; month: { count: number; value: number; deals: Deal[] } };
  meetings: { id: number; meeting_at: string | null; meeting_status: string; prospect: string | null; title: string | null; company: string | null }[];
  feed: { id: number; type: string; body: string; contact: string | null; company: string | null; rep: string | null; created_at: string }[];
  report: { id: number; week_start: string; week_end: string; metrics_json: string; summary: string; blockers: string; plan: string; sent_at: string } | null;
};

const STATUS: Record<string, string> = {
  booked: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  held: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  no_show: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  cancelled: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
};
const FEED: Record<string, string> = {
  call_connected: 'Spoke with', call_no_answer: 'Called', call_voicemail: 'Left a voicemail for', email: 'Emailed',
  linkedin: 'Messaged on LinkedIn', meeting_booked: 'Booked a meeting with', stage_change: '',
};
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Read-only client page. Shown to client accounts, and to the owner as a preview. */
export function Portal() {
  const { me } = useSession();
  const { data, error } = useQuery<PortalData>('/portal');
  if (error && !data) return <p className="p-8 text-red-600">{error}</p>;
  if (!data) return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  const r = data.report;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      {me.user?.role === 'owner' && <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">Preview: this is exactly what {data.client.name} sees.</p>}
      <header className="flex items-center gap-3">
        <ClientLogo client={data.client} size={10} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.client.name}</h1>
          <p className="text-sm text-zinc-500">Outbound results</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3">
        {([['This week', data.pipeline.week], ['This month', data.pipeline.month]] as const).map(([label, p]) => (
          <div key={label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Pipeline created · {label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{money(p.value)}</p>
            <p className="text-sm text-zinc-500">{p.count} new deal{p.count === 1 ? '' : 's'}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Meetings booked</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Prospect</th><th className="px-3 py-2 font-medium">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.meetings.map((mt) => (
                <tr key={mt.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{mt.meeting_at ? new Date(mt.meeting_at.replace(' ', 'T')).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                  <td className="px-3 py-2">{mt.prospect ?? '—'}<span className="text-zinc-500">{mt.title ? `, ${mt.title}` : ''}{mt.company ? ` · ${mt.company}` : ''}</span></td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[mt.meeting_status] ?? STATUS.booked}`}>{mt.meeting_status.replace('_', '-')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.meetings.length && <p className="p-3 text-sm text-zinc-500">No meetings yet.</p>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Latest weekly report</h2>
            {r && <a className="btn py-1 text-xs" href={`/api/portal/reports/${r.id}/pdf`} target="_blank" rel="noopener">Download PDF</a>}
          </div>
          <div className="card p-4">
            {r ? (
              <>
                <p className="mb-3 text-sm text-zinc-500">{fmtDay(r.week_start)} – {fmtDay(r.week_end)}</p>
                <ReportBody m={JSON.parse(r.metrics_json)} summary={r.summary} blockers={r.blockers} plan={r.plan} />
              </>
            ) : <p className="text-sm text-zinc-500">Your first weekly report arrives on Monday.</p>}
          </div>
        </section>
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent activity</h2>
          <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.feed.map((f) => (
              <li key={f.id} className="px-3 py-2 text-sm">
                <p>{f.type === 'stage_change' ? <>{f.company ?? f.contact}: {f.body.replace('Stage: ', '')}</> : <>{FEED[f.type] ?? f.type} {f.contact ?? 'a prospect'}{f.company ? <span className="text-zinc-500"> · {f.company}</span> : ''}</>}</p>
                <p className="text-xs text-zinc-400">{ago(f.created_at)}{f.rep ? ` · ${f.rep}` : ''}</p>
              </li>
            ))}
            {!data.feed.length && <li className="p-3 text-sm text-zinc-500">Nothing yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
