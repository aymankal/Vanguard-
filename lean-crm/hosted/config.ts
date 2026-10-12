// Hosted (claude.ai) replacement for server/config.ts.
import { caps } from './caps';

export const MODEL = 'claude-sonnet-5-5';
export const PORT = 0;
export const DB_PATH = ':memory:';
export const RESEARCH_MAX_SEARCHES = 0;
export const CHAT_MAX_ROUNDS = 8;
export const STALE_DAYS = 7;
export const hasApiKey = () => !!caps.sample;
export const SELLER_PITCH =
  'We provide outsourced SDR teams, sales outsourcing, and multilingual customer support for international companies.';
export const SMTP_URL = '';
export const MAIL_FROM = '';
export const OUTBOX_DIR = '';
export const APP_URL = '';
