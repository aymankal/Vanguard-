import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">L</div>
          <span className="font-semibold">Lean CRM</span>
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-zinc-500">{sub}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Sign in">
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Shell>
  );
}

export function Invite() {
  const { token } = useParams() as { token: string };
  const { reload } = useSession();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ email: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    api<{ email: string; role: string }>(`/auth/invite/${token}`).then(setInfo).catch((e) => setError(e.message));
  }, [token]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/auth/invite/${token}`, { method: 'POST', body: { name, password } });
      await reload();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!info) return <Shell title="Accept invite">{error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-zinc-400">Checking link…</p>}</Shell>;
  return (
    <Shell title="Set up your account" sub={`${info.email} · ${info.role === 'rep' ? 'SDR' : info.role}`}>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <input className="input" type="password" autoComplete="new-password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button className="btn-primary w-full justify-center">Continue</button>
      </form>
    </Shell>
  );
}
