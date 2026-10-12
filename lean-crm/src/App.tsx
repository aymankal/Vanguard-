import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { CommandBar } from './components/CommandBar';
import { useToasts } from './api';
import { Today } from './pages/Today';
import { Pipeline } from './pages/Pipeline';
import { People } from './pages/People';
import { RecordPage } from './pages/Record';
import { Settings } from './pages/Settings';

const NAV = [
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

export function App() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [dark, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const gPressed = useRef(0);
  const toasts = useToasts();

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
        if (n) { navigate(n.to); gPressed.current = 0; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-3 md:flex dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">L</div>
          <span className="font-semibold">Lean CRM</span>
        </div>
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
        <div className="mt-auto">
          <button onClick={toggleTheme} className="btn-ghost w-full justify-start px-2.5 py-1.5 text-sm">{dark ? '☀ Light mode' : '☾ Dark mode'}</button>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2.5 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <span className="flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 place-items-center rounded bg-indigo-600 text-xs text-white">L</span>Lean CRM</span>
        <div className="flex gap-1">
          <button onClick={toggleTheme} className="btn-ghost text-base" aria-label="Toggle theme">{dark ? '☀' : '☾'}</button>
          <button onClick={() => setCmdOpen(true)} className="btn-primary px-2.5 py-1">✦ Ask</button>
        </div>
      </header>

      <main className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/contacts" element={<People />} />
          <Route path="/:kind/:id" element={<RecordPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p className="p-8 text-zinc-500">Page not found.</p>} />
        </Routes>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-zinc-200 bg-white md:hidden dark:border-zinc-800 dark:bg-zinc-900">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) =>
            `flex flex-col items-center py-2 text-[11px] ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500'}`}>
            <span className="text-base leading-none">{n.icon}</span>{n.label}
          </NavLink>
        ))}
      </nav>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto max-w-[90vw] rounded-md px-3 py-2 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
