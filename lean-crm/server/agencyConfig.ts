// Agency Mode knobs. One file, plain numbers.

/** Activity score per logged activity. */
export const SCORE: Record<string, number> = {
  call_no_answer: 1,  // call = 1
  call_voicemail: 1,  // call = 1
  call_connected: 3,  // connected call = 3
  email: 1,
  linkedin: 1,        // not in the original brief; scored like an email. Set to 0 to exclude.
  meeting_booked: 10,
};

/** Outreach activity types (what counts as "activity" for scores, health and reports). */
export const OUTREACH_TYPES = Object.keys(SCORE);
export const CALL_TYPES = ['call_connected', 'call_no_answer', 'call_voicemail'];

/** Client health flags (owner dashboard). */
export const HEALTH = {
  activityDropPct: 30,     // activity down 30%+ vs the previous 7 days
  noMeetingsDays: 14,      // zero meetings booked in 2 weeks
  noActivityDays: 3,       // no logged activity in 3 days
};

/** Weekly client report: Mondays at this local hour, for the previous Monday–Sunday. */
export const REPORT_DEFAULT_TIMEZONE = 'Asia/Beirut';
export const REPORT_WEEKDAY = 1; // Monday
export const REPORT_HOUR = 8;

export function scoreOf(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((sum, [type, n]) => sum + (SCORE[type] ?? 0) * n, 0);
}
