import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Papa from 'papaparse';
import { api, useQuery, write, toast, invalidateAll } from '../api';
import type { Company, Contact } from '../types';
import { Editable } from '../components/Editable';
import { ago } from '../format';

type Kind = 'contacts' | 'companies';
type Col<T> = { key: keyof T & string; label: string; editable?: boolean; type?: 'email'; width?: string; list?: string; render?: (r: T) => React.ReactNode };

const CONTACT_COLS: Col<Contact>[] = [
  { key: 'name', label: 'Name', editable: true, width: 'min-w-44' },
  { key: 'company', label: 'Company', editable: true, list: 'company-names', width: 'min-w-40' },
  { key: 'title', label: 'Title', editable: true, width: 'min-w-40' },
  { key: 'email', label: 'Email', editable: true, type: 'email', width: 'min-w-52' },
  { key: 'phone', label: 'Phone', editable: true, width: 'min-w-36' },
  { key: 'owner', label: 'Owner', editable: true, width: 'min-w-24' },
  { key: 'last_activity', label: 'Last touch', width: 'min-w-24', render: (r) => <span className="text-zinc-500">{ago(r.last_activity)}</span> },
];
const COMPANY_COLS: Col<Company>[] = [
  { key: 'name', label: 'Name', editable: true, width: 'min-w-44' },
  { key: 'website', label: 'Website', editable: true, width: 'min-w-40' },
  { key: 'industry', label: 'Industry', editable: true, width: 'min-w-32' },
  { key: 'size', label: 'Size', editable: true, width: 'min-w-24' },
  { key: 'contact_count', label: 'Contacts', width: 'min-w-20', render: (r) => <span className="text-zinc-500">{r.contact_count ?? 0}</span> },
  { key: 'notes', label: 'Notes', editable: true, width: 'min-w-64' },
];
const CSV_FIELDS: Record<Kind, string[]> = {
  contacts: ['name', 'email', 'phone', 'title', 'company', 'owner'],
  companies: ['name', 'website', 'industry', 'size', 'notes'],
};

export function People() {
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tab') === 'companies' ? 'companies' : 'contacts';
  const contacts = useQuery<Contact[]>('/contacts');
  const companies = useQuery<Company[]>('/companies');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [newName, setNewName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const query = kind === 'contacts' ? contacts : companies;
  const cols = (kind === 'contacts' ? CONTACT_COLS : COMPANY_COLS) as Col<Record<string, unknown> & { id: number }>[];

  const rows = useMemo(() => {
    const all = (query.data ?? []) as (Record<string, unknown> & { id: number })[];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? all.filter((r) => cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle))) : all;
    return [...filtered].sort((a, b) => {
      const x = a[sort.key] ?? '', y = b[sort.key] ?? '';
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' })) * sort.dir;
    });
  }, [query.data, q, sort, cols]);

  const save = (id: number, key: string, value: string) => {
    const prev = (query.data as any[])?.find((r) => r.id === id)?.[key];
    (query.mutate as (fn: (d: any[]) => any[]) => void)((d) => d.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    write(api(`/${kind}/${id}`, { method: 'PATCH', body: { [key]: value } }), () =>
      (query.mutate as (fn: (d: any[]) => any[]) => void)((d) => d.map((r) => (r.id === id ? { ...r, [key]: prev } : r))),
    ).then((r) => r && key === 'company' && invalidateAll());
  };

  const remove = (id: number, name: string) => {
    if (!confirm(`Delete ${name}? This also removes its timeline.`)) return;
    (query.mutate as (fn: (d: any[]) => any[]) => void)((d) => d.filter((r) => r.id !== id));
    write(api(`/${kind}/${id}`, { method: 'DELETE' }));
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    (query.mutate as (fn: (d: any[]) => any[]) => void)((d) => [{ id: -Date.now(), name }, ...d]);
    await write(api(`/${kind}`, { method: 'POST', body: { name } }));
    invalidateAll();
  };

  const exportCsv = () => {
    const csv = Papa.unparse(rows.map((r) => Object.fromEntries(CSV_FIELDS[kind].map((f) => [f, r[f] ?? '']))));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${kind}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importCsv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        if (!res.data.length) return toast('That CSV has no rows.', 'error');
        if (!res.meta.fields?.some((f) => f.trim().toLowerCase() === 'name')) return toast('The CSV needs a "name" column.', 'error');
        const r = await write(api<{ created: number; skipped: string[] }>(`/import/${kind}`, { method: 'POST', body: { rows: res.data } }));
        if (r) {
          toast(`Imported ${r.created} ${kind}${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`, r.skipped.length ? 'error' : 'ok');
          invalidateAll();
        }
      },
      error: () => toast("Couldn't read that file. Is it a CSV?", 'error'),
    });
  };

  return (
    <div className="space-y-4 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
          {(['contacts', 'companies'] as Kind[]).map((k) => (
            <button key={k} onClick={() => setParams(k === 'companies' ? { tab: k } : {})}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${kind === k ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500'}`}>
              {k} <span className="text-xs font-normal text-zinc-400">{(k === 'contacts' ? contacts.data : companies.data)?.length ?? ''}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => fileRef.current?.click()}>Import CSV</button>
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
        </div>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input ref={searchRef} className="input pr-8" placeholder={`Search ${kind}…`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.currentTarget.blur())} />
          <span className="kbd absolute top-2 right-2">/</span>
        </div>
        <form onSubmit={add} className="flex gap-2 sm:w-80">
          <input className="input" placeholder={kind === 'contacts' ? 'New contact name' : 'New company name'} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn-primary" disabled={!newName.trim()}>Add</button>
        </form>
      </div>

      <datalist id="company-names">{companies.data?.map((c) => <option key={c.id} value={c.name} />)}</datalist>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="w-8" />
              {cols.map((c) => (
                <th key={c.key} className={`px-2 py-2 font-medium ${c.width ?? ''}`}>
                  <button className="hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : 1 }))}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id} className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                <td className="pl-2">
                  {r.id > 0 && <Link to={`/${kind}/${r.id}`} className="btn-ghost" title="Open record" aria-label={`Open ${String(r.name)}`}>↗</Link>}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="max-w-72 px-2 py-1">
                    {c.render ? c.render(r) : c.editable && r.id > 0 ? (
                      <Editable value={r[c.key] as string} type={c.type} list={c.list} onSave={(v) => save(r.id, c.key, v)} />
                    ) : (
                      <span className="block truncate px-0 py-0.5">{String(r[c.key] ?? '')}</span>
                    )}
                  </td>
                ))}
                <td className="pr-2">
                  {r.id > 0 && <button className="btn-ghost opacity-0 group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100" onClick={() => remove(r.id, String(r.name))} aria-label="Delete">✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-8 text-center text-sm text-zinc-500">{query.data ? (q ? 'No matches.' : `No ${kind} yet. Add one above or import a CSV.`) : 'Loading…'}</p>}
      </div>
      <p className="text-xs text-zinc-400">Click any cell to edit. CSV columns: {CSV_FIELDS[kind].join(', ')}.</p>
    </div>
  );
}
