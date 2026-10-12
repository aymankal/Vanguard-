import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { CommandBar } from './components/CommandBar';
import { ClientSwitcher } from './components/ClientSwitcher';
import { api, useToasts, dismissToast } from './api';
import { useSession } from './session';
import { Today } from './pages/Today';
import { Pipeline } from './pages/Pipeline';
import { People } from './pages/People';
import { RecordPage } from './pages/Record';
import { Settings } from './pages/Settings';
import { Login, Invite } from './pages/Login';
import { Agency } from './pages/Agency';
import { Portal } from './pages/Portal';

const BASE_NAV = [
  { to: '/', label: 'Today', key: 't', icon: '◎' },
  { to: '/pipeline', label: 'Pipeline', key: 'p', icon: '▥' },
  { to: '/contacts', label: 'Contacts', key: 'c', icon: '☰' },
  { to: '/settings', label: 'Settings', key: 's', icon: '⚙' },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 md:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex max-w-[90vw] items-center gap-3 rounded-md px-3 py-2 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}`}>
          <span>{t.text}</span>
          {t.action && <button className="font-semibold underline underline-offset-2" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { me } = useSession();
  if (me.agency && !me.user) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (me.user?.role === 'client') return <ClientShell />;
  return <Main />;
}

function SignOut({ className = '' }: { className?: string }) {
  const { reload } = useSession();
  return <button className={className} onClick={async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); await reload(); }}>Sign out</button>;
}

/** Client accounts: one read-only page, nothing else. */
function ClientShell() {
  const [dark, toggleTheme] = useTheme();
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded bg-indigo-600 text-xs text-white">L</span>Client portal</span>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="btn-ghost text-base" aria-label="Toggle theme">{dark ? '☀' : '☾'}</button>
          <SignOut className="btn-ghost" />
        </div>
      </header>
      <Portal />
      <Toasts />
    </div>
  );
}

function Main() {
  const { me, client } = useSession();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [dark, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const gPressed = useRef(0);
  const agency = me.agency;
  const isOwner = !agency || me.user?.role === 'owner';
  const NAV = agency && isOwner ? [{ to: '/agency', label: 'Agency', key: 'a', icon: '◈' }, ...BASE_NAV] : BASE_NAV;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'g') { gPressed.current = Date.now(); return; }
      if (Date.now() - gPressed.current < 1000) {
        const n = NAV.find((x) => x.key === e.key);
        if (n) { e.preventDefault(); navigate(n.to); gPressed.current = 0; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, NAV]);

  if (agency && !client) {
    return <div className="grid min-h-full place-items-center p-8 text-center text-sm text-zinc-500"><div>No client workspaces are assigned to you yet. Ask the agency owner.<br /><SignOut className="btn mt-4" /></div></div>;
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-3 md:flex dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">L</div>
          <span className="font-semibold">Lean CRM</span>
        </div>
        {agency && <div className="mb-3"><ClientSwitcher /></div>}
        <button onClick={() => setCmdOpen(true)} className="mb-4 flex items-center justify-between rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-500 hover:border-indigo-400 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200">
          <span>✦ Ask or command</span><span className="kbd">⌘K</span>
        </button>
        <nav className="space-y-0.5">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) =>
              `flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${isActive ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50'}`}>
              <span className="flex items-center gap-2"><span className="w-4 text-center opacity-70">{n.icon}</span>{n.label}</span>
              <span className="text-[10px] text-zinc-400">g {n.key}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1">
          {agency && <p className="truncate px-2.5 text-xs text-zinc-400" title={me.user?.email}>{me.user?.name} · {me.user?.role === 'rep' ? 'SDR' : 'Owner'}</p>}
          <button onClick={toggleTheme} className="btn-ghost w-full justify-start px-2.5 py-1.5 text-sm">{dark ? '☀ Light mode' : '☾ Dark mode'}</button>
          {agency && <SignOut className="btn-ghost w-full justify-start px-2.5 py-1.5 text-sm" />}
        </div>
      </aside>

      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2.5 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
        {agency ? <ClientSwitcher compact /> : <span className="flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 place-items-center rounded bg-indigo-600 text-xs text-white">L</span>Lean CRM</span>}
        <div className="flex shrink-0 gap-1">
          <button onClick={toggleTheme} className="btn-ghost text-base" aria-label="Toggle theme">{dark ? '☀' : '☾'}</button>
          <button onClick={() => setCmdOpen(true)} className="btn-primary px-2.5 py-1">✦ Ask</button>
        </div>
      </header>

      <main className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/contacts" element={<People />} />
          {agency && isOwner && <Route path="/agency/*" element={<Agency />} />}
          {agency && isOwner && <Route path="/portal" element={<Portal />} />}
          <Route path="/:kind/:id" element={<RecordPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p className="p-8 text-zinc-500">Page not found.</p>} />
        </Routes>
      </main>

      <nav className={`fixed inset-x-0 bottom-0 z-40 grid border-t border-zinc-200 bg-white md:hidden dark:border-zinc-800 dark:bg-zinc-900 ${NAV.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) =>
            `flex flex-col items-center py-2 text-[11px] ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500'}`}>
            <span className="text-base leading-none">{n.icon}</span>{n.label}
          </NavLink>
        ))}
      </nav>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <Toasts />
    </div>
  );
}
