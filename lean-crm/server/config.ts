import 'dotenv/config';

/** The one place to change which Claude model Lean CRM uses. */
export const MODEL = 'claude-sonnet-5-5';

export const PORT = Number(process.env.PORT) || 3001;
export const DB_PATH = process.env.DB_PATH || new URL('../data/lean-crm.db', import.meta.url).pathname;

/** Cap on web searches per Research click (cost control). */
export const RESEARCH_MAX_SEARCHES = 5;
/** Cap on tool-loop rounds per command bar message. */
export const CHAT_MAX_ROUNDS = 8;
/** A deal with no activity for this many days shows up on Today. */
export const STALE_DAYS = 7;

export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

/**
 * What you sell. Research uses it to frame pain points, talking points and the outreach draft.
 * Edit to match your business.
 */
export const SELLER_PITCH =
  'We provide outsourced SDR teams, sales outsourcing, and multilingual customer support for international companies.';
