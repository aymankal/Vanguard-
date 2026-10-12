export const money = (n: number | null | undefined) =>
  '$' + (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const moneyShort = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → Date */
export const parseTs = (s: string) => new Date(s.replace(' ', 'T') + (s.length > 10 ? 'Z' : ''));

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

export function ago(s: string | null) {
  if (!s) return 'never';
  const days = Math.floor((Date.now() - parseTs(s).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function dueLabel(d: string | null) {
  if (!d) return 'No date';
  const t = todayStr();
  if (d === t) return 'Today';
  if (d === addDays(t, 1)) return 'Tomorrow';
  if (d === addDays(t, -1)) return 'Yesterday';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const fmtDate = (s: string) =>
  parseTs(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
