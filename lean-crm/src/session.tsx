import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setActiveClient } from './api';
import type { Client, Me } from './types';

type Session = {
  me: Me;
  reload: () => Promise<void>;
  clientId: number | null;
  client: Client | null;
  switchClient: (id: number) => void;
};
const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;

const STORE = 'lc_client';
const read = () => { try { return Number(localStorage.getItem(STORE)) || null; } catch { return null; } };
const write = (id: number) => { try { localStorage.setItem(STORE, String(id)); } catch { /* private mode */ } };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const m = await api<Me>('/auth/me').catch(() => ({ agency: false, user: null, clients: [] }) as Me);
    let id: number | null = null;
    if (m.agency && m.user) {
      const saved = read();
      id = m.clients.some((c) => c.id === saved) ? saved : m.clients[0]?.id ?? null;
    }
    setActiveClient(id);
    setClientId(id);
    setMe(m);
  }, []);

  useEffect(() => {
    reload();
    const onOut = () => reload();
    window.addEventListener('lc:signed-out', onOut);
    return () => window.removeEventListener('lc:signed-out', onOut);
  }, [reload]);

  const switchClient = useCallback((id: number) => {
    write(id);
    setActiveClient(id);
    setClientId(id);
  }, []);

  if (!me) return null;
  const client = me.clients.find((c) => c.id === clientId) ?? null;
  return <Ctx.Provider value={{ me, reload, clientId, client, switchClient }}>{children}</Ctx.Provider>;
}
