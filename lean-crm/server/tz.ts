// Minimal timezone math with Intl (no dependencies). All DB timestamps are UTC "YYYY-MM-DD HH:MM:SS".

/** Offset (minutes) of `tz` from UTC at the given instant. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Local wall-clock parts of an instant in `tz`. */
export function localParts(at: Date, tz: string) {
  const local = new Date(at.getTime() + offsetMinutes(at, tz) * 60000);
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours(),
    weekday: local.getUTCDay(), // 0 = Sunday
  };
}

/** UTC instant of local midnight on `date` (YYYY-MM-DD) in `tz`. */
export function localMidnightUtc(date: string, tz: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess, tz) * 60000);
  // Re-check across DST changes.
  return new Date(guess.getTime() - offsetMinutes(first, tz) * 60000);
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Monday (YYYY-MM-DD) of the local week containing `at`. */
export function weekStart(at: Date, tz: string): string {
  const { date, weekday } = localParts(at, tz);
  return addDays(date, -((weekday + 6) % 7));
}

/** SQLite UTC timestamp string. */
export const sqlTs = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** [start, end) of local days [fromDate, toDateExclusive) as SQLite UTC strings. */
export function range(fromDate: string, toDateExclusive: string, tz: string): [string, string] {
  return [sqlTs(localMidnightUtc(fromDate, tz)), sqlTs(localMidnightUtc(toDateExclusive, tz))];
}
