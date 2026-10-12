import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import type { Client } from '../types';

export function ClientLogo({ client, size = 6 }: { client: Pick<Client, 'name' | 'logo_url'> | null; size?: 5 | 6 | 8 | 10 }) {
  const cls = { 5: 'h-5 w-5 text-[10px]', 6: 'h-6 w-6 text-xs', 8: 'h-8 w-8 text-sm', 10: 'h-10 w-10 text-base' }[size];
  if (client?.logo_url) return <img src={client.logo_url} alt="" className={`${cls} shrink-0 rounded object-cover`} />;
  return <span className={`${cls} grid shrink-0 place-items-center rounded bg-zinc-200 font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200`}>{client?.name?.[0]?.toUpperCase() ?? '∗'}</span>;
}

/** Hook used by the switcher and the command bar so both behave the same. */
export function useSwitchClient() {
  const { switchClient } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  return (id: number | 'all') => {
    if (id === 'all') return navigate('/agency');
    switchClient(id);
    // Records belong to one client, so leave record pages and the rollup when switching.
    if (/^\/(contacts|companies|deals)\/\d+/.test(location.pathname) || location.pathname.startsWith('/agency')) navigate('/');
  };
}

export function ClientSwitcher({ compact = false }: { compact?: boolean }) {
  const { me, client } = useSession();
  const location = useLocation();
  const go = useSwitchClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isOwner = me.user?.role === 'owner';
  const onAll = location.pathname.startsWith('/agency');

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className={`flex w-full items-center gap-2 rounded-md border border-zinc-300 px-2 py-1.5 text-left text-sm hover:border-indigo-400 dark:border-zinc-700 ${compact ? 'max-w-44' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {onAll && isOwner ? <span className="grid h-5 w-5 place-items-center rounded bg-indigo-600 text-[10px] text-white">∗</span> : <ClientLogo client={client} size={5} />}
        <span className="min-w-0 flex-1 truncate font-medium">{onAll && isOwner ? 'All clients' : client?.name ?? 'No client'}</span>
        <span className="text-xs text-zinc-400">▾</span>
      </button>
      {open && (
        <ul role="listbox" className="absolute left-0 z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {isOwner && (
            <li>
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => { setOpen(false); go('all'); }}>
                <span className="grid h-5 w-5 place-items-center rounded bg-indigo-600 text-[10px] text-white">∗</span> All clients
              </button>
            </li>
          )}
          {me.clients.map((c) => (
            <li key={c.id}>
              <button
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${c.id === client?.id && !onAll ? 'bg-zinc-100 font-medium dark:bg-zinc-800' : ''}`}
                onClick={() => { setOpen(false); go(c.id); }}
              >
                <ClientLogo client={c} size={5} />
                <span className="flex-1 truncate text-left">{c.name}</span>
                {c.status !== 'active' && <span className="text-[10px] uppercase text-zinc-400">{c.status}</span>}
              </button>
            </li>
          ))}
          <li className="px-2 pt-1 pb-0.5 text-[10px] text-zinc-400">Tip: ⌘K, then type a client name</li>
        </ul>
      )}
    </div>
  );
}
