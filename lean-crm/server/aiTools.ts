// Tools the command bar can call. Read tools run immediately; write tools only produce
// proposals that the user must confirm before anything is committed.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db, type Row } from './db.js';
import * as repo from './repo.js';
import * as store from './store.js';
import type { Scope } from './scope.js';

const opt = z.string().trim().optional().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional().nullable();

export const writeSchemas = {
  create_company: z.object({ name: z.string().trim().min(1), website: opt, industry: opt, size: opt, notes: opt }),
  create_contact: z.object({ name: z.string().trim().min(1), email: opt, phone: opt, title: opt, company: opt, owner: opt }),
  create_deal: z.object({
    title: z.string().trim().min(1), value: z.coerce.number().optional().nullable(), stage: opt,
    company: opt, contact: opt, close_date: date,
  }),
  update_deal_stage: z.object({ deal: z.string().trim().min(1), stage: z.string().trim().min(1) }),
  create_task: z.object({ title: z.string().trim().min(1), due_date: date, contact: opt, deal: opt }),
  log_note: z.object({
    body: z.string().trim().min(1), type: z.enum(['note', 'email']).optional().nullable(),
    contact: opt, company: opt, deal: opt,
  }),
};
export type WriteTool = keyof typeof writeSchemas;
export type Action = { tool: WriteTool; input: Row; summary: string };

const readSchemas = {
  search_records: z.object({
    type: z.enum(['contacts', 'companies', 'deals', 'tasks']),
    query: opt, stage: opt, close_from: date, close_to: date, due_from: date, due_to: date,
    inactive_days: z.coerce.number().int().positive().optional().nullable(),
    open_only: z.boolean().optional().nullable(), include_done: z.boolean().optional().nullable(),
  }),
  summarize_account: z.object({ company: opt, contact: opt }),
};

const s = (description: string) => ({ type: 'string', description });
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'create_contact',
    description: 'Propose creating a contact (a person). If `company` does not exist it will be created too.',
    input_schema: { type: 'object', properties: {
      name: s('Full name'), email: s('Email'), phone: s('Phone'), title: s('Job title'),
      company: s('Company name'), owner: s('Owner (salesperson) name'),
    }, required: ['name'] },
  },
  {
    name: 'create_company',
    description: 'Propose creating a company (an account).',
    input_schema: { type: 'object', properties: {
      name: s('Company name'), website: s('Domain or URL'), industry: s('Industry'), size: s('Employee range, e.g. 51-200'), notes: s('Notes'),
    }, required: ['name'] },
  },
  {
    name: 'create_deal',
    description: 'Propose creating a deal. Reference company/contact by exact name (existing or proposed earlier in this turn).',
    input_schema: { type: 'object', properties: {
      title: s('Deal title, e.g. "Acme — SDR pod"'), value: { type: 'number', description: 'Value in dollars, e.g. 15000' },
      stage: s('Pipeline stage name'), company: s('Company name'), contact: s('Contact name'), close_date: s('Expected close date YYYY-MM-DD'),
    }, required: ['title'] },
  },
  {
    name: 'update_deal_stage',
    description: 'Propose moving a deal to another pipeline stage.',
    input_schema: { type: 'object', properties: { deal: s('Deal title (or a distinctive part of it)'), stage: s('Target stage name') }, required: ['deal', 'stage'] },
  },
  {
    name: 'create_task',
    description: 'Propose a to-do/follow-up. Link to a contact and/or deal by name when relevant.',
    input_schema: { type: 'object', properties: {
      title: s('What to do'), due_date: s('Due date YYYY-MM-DD'), contact: s('Contact name'), deal: s('Deal title'),
    }, required: ['title'] },
  },
  {
    name: 'log_note',
    description: 'Propose logging a note or an email on a contact, company or deal timeline.',
    input_schema: { type: 'object', properties: {
      body: s('Note text'), type: { type: 'string', enum: ['note', 'email'], description: 'note (default) or email' },
      contact: s('Contact name'), company: s('Company name'), deal: s('Deal title'),
    }, required: ['body'] },
  },
  {
    name: 'search_records',
    description:
      'Look up CRM data. Use for any question about contacts, companies, deals or tasks. ' +
      'Filters are optional and combine with AND. Returns up to 50 rows as JSON.',
    input_schema: { type: 'object', properties: {
      type: { type: 'string', enum: ['contacts', 'companies', 'deals', 'tasks'] },
      query: s('Free-text match on names, titles, emails, companies'),
      stage: s('deals: stage name'),
      close_from: s('deals: close date on/after YYYY-MM-DD'), close_to: s('deals: close date on/before YYYY-MM-DD'),
      due_from: s('tasks: due on/after YYYY-MM-DD'), due_to: s('tasks: due on/before YYYY-MM-DD'),
      inactive_days: { type: 'integer', description: 'contacts/deals: no activity in at least this many days' },
      open_only: { type: 'boolean', description: 'deals: exclude Won and Lost' },
      include_done: { type: 'boolean', description: 'tasks: include completed tasks' },
    }, required: ['type'] },
  },
  {
    name: 'summarize_account',
    description: 'Fetch everything about one company or contact (details, people, deals, open tasks, recent timeline) so you can summarize it.',
    input_schema: { type: 'object', properties: { company: s('Company name'), contact: s('Contact name') } },
  },
].map((t) => ({ ...t, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);

export const isWriteTool = (name: string): name is WriteTool => name in writeSchemas;

// ---------- Apply (the only path that commits AI-proposed changes) ----------

function findDeal(s: Scope, ref: string): number {
  const rows = repo.dealsByTitle(s, ref);
  if (rows.length === 1) return rows[0].id as number;
  if (!rows.length) throw new store.UserError(`No deal matching "${ref}".`);
  throw new store.UserError(`"${ref}" matches several deals: ${rows.map((d) => d.title).join('; ')}. Be more specific.`);
}

export type Applied = { kind: 'contact' | 'company' | 'deal' | 'task' | 'note'; id: number; label: string };

function applyOne(s: Scope, a: { tool: WriteTool; input: Row }): Applied {
  const i = writeSchemas[a.tool].parse(a.input) as Row;
  switch (a.tool) {
    case 'create_company':
      return { kind: 'company', id: store.createCompany(s, i), label: String(i.name) };
    case 'create_contact':
      return { kind: 'contact', id: store.createContact(s, i), label: String(i.name) };
    case 'create_deal':
      return { kind: 'deal', id: store.createDeal(s, i), label: String(i.title) };
    case 'update_deal_stage': {
      const id = findDeal(s, String(i.deal));
      store.setDealStage(s, id, store.resolveStage(i.stage));
      return { kind: 'deal', id, label: `${i.deal} → ${i.stage}` };
    }
    case 'create_task': {
      const deal_id = i.deal ? findDeal(s, String(i.deal)) : null;
      const contact_id = i.contact ? store.resolveContact(s, i.contact) : null;
      return { kind: 'task', id: store.createTask(s, { ...i, deal_id, contact_id }), label: String(i.title) };
    }
    case 'log_note': {
      const deal_id = i.deal ? findDeal(s, String(i.deal)) : null;
      const contact_id = i.contact ? store.resolveContact(s, i.contact) : null;
      const company_id = i.company ? store.resolveCompany(s, i.company, false) : null;
      if (i.company && !company_id) throw new store.UserError(`No company named "${i.company}".`);
      const id = store.addActivity(s, { type: i.type ?? 'note', body: i.body, deal_id, contact_id, company_id });
      const target = deal_id ? { kind: 'deal' as const, id: deal_id } : contact_id ? { kind: 'contact' as const, id: contact_id } : { kind: 'company' as const, id: company_id! };
      return { ...target, label: `Note logged (#${id})` };
    }
  }
}

/** Commit confirmed actions atomically. */
export function applyActions(s: Scope, actions: { tool: WriteTool; input: Row }[]): Applied[] {
  return db.transaction(() => actions.map((a) => applyOne(s, a)))();
}

class Rollback extends Error {}
/**
 * Validate a proposal against the live data plus earlier proposals by running them inside a
 * transaction that is always rolled back. Nothing is ever committed here.
 */
export function dryRun(s: Scope, actions: { tool: WriteTool; input: Row }[]): string | null {
  try {
    db.transaction(() => {
      actions.forEach((a) => applyOne(s, a));
      throw new Rollback();
    })();
  } catch (e) {
    if (e instanceof Rollback) return null;
    if (e instanceof z.ZodError) return e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
    return (e as Error).message;
  }
  return null;
}

export function summarize(tool: WriteTool, i: Row): string {
  const bits = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ');
  const money = (v: unknown) => (v ? `$${Number(v).toLocaleString('en-US')}` : null);
  switch (tool) {
    case 'create_company': return `New company **${i.name}**` + (bits({ industry: i.industry, size: i.size }) ? ` — ${bits({ industry: i.industry, size: i.size })}` : '');
    case 'create_contact': return `New contact **${i.name}**` + (bits({ company: i.company, title: i.title, email: i.email }) ? ` — ${bits({ company: i.company, title: i.title, email: i.email })}` : '');
    case 'create_deal': return `New deal **${i.title}** — ${bits({ value: money(i.value), stage: i.stage, company: i.company, contact: i.contact, close: i.close_date })}`;
    case 'update_deal_stage': return `Move **${i.deal}** to **${i.stage}**`;
    case 'create_task': return `Task **${i.title}**` + (bits({ due: i.due_date, contact: i.contact, deal: i.deal }) ? ` — ${bits({ due: i.due_date, contact: i.contact, deal: i.deal })}` : '');
    case 'log_note': return `Log ${i.type ?? 'note'} on **${i.deal ?? i.contact ?? i.company}**: “${String(i.body).slice(0, 120)}”`;
  }
}

// ---------- Read tools (scoped) ----------
export function runReadTool(s: Scope, name: string, input: unknown): string {
  if (name === 'search_records') return JSON.stringify(repo.searchRecords(s, readSchemas.search_records.parse(input)));
  if (name === 'summarize_account') return JSON.stringify(repo.accountSummary(s, readSchemas.summarize_account.parse(input)));
  throw new store.UserError(`Unknown tool ${name}`);
}
