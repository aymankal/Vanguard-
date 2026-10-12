// Lean CRM on claude.ai: the full app, running in the page.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Buffer } from 'buffer';
import { loadCaps, caps } from './caps';

// The PDF report code expects Node's Buffer.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
import '../src/index.css';

function setTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}

function status(msg: string) {
  const el = document.getElementById('boot');
  if (el) el.textContent = msg;
}

(async () => {
  setTheme();
  new MutationObserver(setTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  status('Connecting…');
  await loadCaps();
  status('Loading your CRM…');
  const { boot, installFetch, installDownloads } = await import('./server');
  const { App } = await import('../src/App');
  const { SessionProvider } = await import('../src/session');
  const { toast, invalidateAll } = await import('../src/api');
  installFetch();
  installDownloads(toast);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await boot({
    error: (m) => toast(m, 'error'),
    remote: () => { clearTimeout(timer); timer = setTimeout(invalidateAll, 250); },
  });
  if (!caps.db) toast('Shared storage isn’t available in this view, so changes stay in this tab only.', 'error');
  document.getElementById('boot')?.remove();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MemoryRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </MemoryRouter>
    </StrictMode>,
  );
})();
