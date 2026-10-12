// Hosted replacement for server/ai.ts. Same routes and event stream as the server version; Claude
// runs through the viewer's claude.ai account (`sample`). Write tools still only PROPOSE changes.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Router } from './shims/express';
import { MODEL, SELLER_PITCH } from './config';
import { db, today, type Row } from '../server/db.js';
import * as repo from '../server/repo.js';
import { claude, friendlyError, MissingKeyError } from './errors';
import { TOOLS, isWriteTool, writeSchemas, dryRun, applyActions, summarize, runReadTool, type Action, type WriteTool } from '../server/aiTools.js';
import { UserError } from '../server/store.js';
import { caps } from './caps';

export const ai = Router();
export const FALLBACK = {};

function sse(req: any, res: any) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const send = (data: Record<string, unknown>) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  return { send, abort, end: () => res.end() };
}

ai.get('/status', (_req: any, res: any) => {
  res.json(caps.sample
    ? { ok: true, model: MODEL, message: 'Connected through your claude.ai account.' }
    : { ok: false, model: MODEL, message: new MissingKeyError().message });
});

const SYSTEM = `You are the command bar inside Lean CRM, a minimal CRM for a solo seller or small sales team.

You do two jobs:
1. Turn plain-English instructions into CRM changes using the create_*, update_deal_stage and log_note tools.
   These tools only PROPOSE changes; the user sees a confirmation card and clicks Confirm. Call every tool needed
   for the whole instruction in one go (e.g. contact + company + deal + task). Reuse existing records: if a company
   or contact might already exist, search_records first and use the exact existing name. Resolve relative dates
   ("Friday", "next week", "end of month") to YYYY-MM-DD using today's date. "$15k" means 15000. Stage names must
   match an existing pipeline stage. Don't invent emails, phones or other details the user didn't give.
2. Answer questions about the data. Always look it up with search_records or summarize_account; never guess.

Style: terse. After proposing changes, reply with one short line (the card shows the details). For answers, use a
short list with names, values and dates. No preamble, no follow-up offers. Markdown allowed (bold, lists).`;

const ChatBody = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) })).min(1).max(40),
});

ai.post('/chat', async (req: any, res: any) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad chat request.' });
  const { send, abort, end } = sse(req, res);
  const scope = req.scope;
  const stages = (db.prepare('SELECT name FROM stages ORDER BY position').all() as Row[]).map((s) => s.name);
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const client = scope.agency ? (db.prepare('SELECT name FROM clients WHERE id = ?').get(scope.clientId) as Row | undefined)?.name : null;
  const context = `Today is ${weekday} ${today()}. Pipeline stages, in order: ${stages.join(', ')}.${client ? ` You are working inside the client workspace "${client}".` : ''}`;
  const msgs = parsed.data.messages.map((m) => ({ ...m }));
  msgs[0] = { ...msgs[0], content: `${SYSTEM}\n\n${context}\n\n---\n\n${msgs[0].content}` };

  const proposals: Action[] = [];
  const tools = TOOLS.map((t: any) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
    execute: async (input: Record<string, unknown>) => {
      if (isWriteTool(t.name)) {
        const tool: WriteTool = t.name;
        const check = writeSchemas[tool].safeParse(input);
        if (!check.success) throw new Error(check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        const action: Action = { tool, input: check.data as Row, summary: summarize(tool, check.data as Row) };
        const problem = dryRun(scope, [...proposals, action]);
        if (problem) throw new Error(problem);
        proposals.push(action);
        send({ type: 'proposal', action });
        return 'Queued for the user to confirm. Not saved yet.';
      }
      send({ type: 'status', text: t.name === 'search_records' ? 'Searching…' : 'Reading account…' });
      return runReadTool(scope, t.name, input).slice(0, 30000);
    },
  }));

  try {
    if (!caps.sample) throw new MissingKeyError();
    let shown = '';
    await caps.sample(msgs, {
      tools,
      model: MODEL,
      modelTier: 'default',
      signal: abort.signal,
      onText: ({ text }: { text: string }) => {
        if (text.startsWith(shown)) send({ type: 'text', text: text.slice(shown.length) });
        shown = text;
      },
    });
    send({ type: 'done' });
  } catch (e) {
    if (!abort.signal.aborted && (e as { code?: string })?.code !== 'cancelled') send({ type: 'error', message: friendlyError(e).message });
  }
  end();
});

const ApplyBody = z.object({
  actions: z.array(z.object({ tool: z.enum(Object.keys(writeSchemas) as [WriteTool, ...WriteTool[]]), input: z.record(z.string(), z.unknown()) })).min(1).max(30),
});
ai.post('/apply', (req: any, res: any) => {
  const parsed = ApplyBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Nothing to apply.' });
  try {
    res.json({ applied: applyActions(req.scope, parsed.data.actions as { tool: WriteTool; input: Row }[]) });
  } catch (e) {
    const msg = e instanceof z.ZodError ? 'One of the changes is incomplete.' : (e as Error).message;
    res.status(400).json({ error: `Nothing was saved: ${msg}` });
  }
});

// ---------- Research (no live web search on claude.ai pages) ----------
const ResearchBody = z.object({ kind: z.enum(['company', 'contact']), id: z.number().int() });
const NOTE = '_Written from Claude’s own knowledge. This hosted version can’t search the live web, so check recent facts before you send anything._\n\n';

ai.post('/research', async (req: any, res: any) => {
  const parsed = ResearchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad research request.' });
  const { kind, id } = parsed.data;
  const c = repo.researchSubject(req.scope, kind, id);
  if (!c) return res.status(404).json({ error: `${kind === 'company' ? 'Company' : 'Contact'} not found.` });
  const subject = kind === 'company'
    ? `Company: ${c.name}${c.website ? ` (website: ${c.website})` : ''}${c.industry ? `, industry: ${c.industry}` : ''}.`
    : `Person: ${c.name}${c.title ? `, ${c.title}` : ''}${c.company ? ` at ${c.company}` : ''}${c.website ? ` (${c.website})` : ''}.`;
  const { send, abort, end } = sse(req, res);
  const prompt = `Write a research brief on this sales prospect for a seller. You cannot browse the web: use only what you already know, and write "Unknown" where you are not sure. Never invent news, numbers or people.

${subject}

What we sell: ${SELLER_PITCH}

Output ONLY the brief in Markdown with exactly these sections, no intro:
## What they do
2-3 sentences.
## Size
Employees, revenue/funding, locations if known. Say "Unknown" rather than guess.
## Recent news
Up to 3 bullets with dates, only if you know them; otherwise "No recent news on record."
## Likely pain points
3 bullets tied to what we sell.
## Talking points
Exactly 3 numbered points.
## Draft first outreach
A short email (subject line + under 120 words), specific to them, one clear ask. ${kind === 'contact' ? 'Address the person by first name.' : ''}

Today is ${today()}.`;
  try {
    if (!caps.sample) throw new MissingKeyError();
    send({ type: 'status', text: 'Writing brief…' });
    let shown = '';
    const r = await caps.sample(prompt, {
      model: MODEL, modelTier: 'default', cache: false, signal: abort.signal,
      onText: ({ text }: { text: string }) => {
        if (text.startsWith(shown)) send({ type: 'text', text: (shown ? '' : NOTE) + text.slice(shown.length) });
        shown = text;
      },
    });
    send({ type: 'final', markdown: NOTE + r.text.trim(), sources: [] });
  } catch (e) {
    if (!abort.signal.aborted && (e as { code?: string })?.code !== 'cancelled') send({ type: 'error', message: friendlyError(e).message });
  }
  end();
});

// ---------- Next best action ----------
ai.get('/nba/:id', (req: any, res: any) => {
  const id = Number(req.params.id);
  const d = repo.dealRow(req.scope, id);
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  res.json({ text: d.nba_text ?? null, fresh: !!d.nba_text && d.nba_key === repo.nbaKey(req.scope, id) });
});

ai.post('/nba/:id', async (req: any, res: any) => {
  const id = Number(req.params.id);
  const deal = repo.dealRow(req.scope, id);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  const key = repo.nbaKey(req.scope, id);
  if (deal.nba_text && deal.nba_key === key && !req.query.force) return res.json({ text: deal.nba_text, fresh: true });
  const timeline = repo.dealTimeline(req.scope, id);
  const tasks = repo.openDealTasks(req.scope, id);
  const stages = (db.prepare('SELECT name FROM stages ORDER BY position').all() as Row[]).map((s) => s.name).join(' → ');
  try {
    const msg = await claude().beta.messages.create({
      messages: [{
        role: 'user',
        content: `You are a sharp sales manager. Based on this deal's timeline, give the single next best action.
Reply with ONE line, max 20 words, imperative, specific (who, what, when). No preamble, no quotes.

Today: ${today()}
Pipeline: ${stages}
Deal: ${JSON.stringify({ title: deal.title, value: deal.value, stage: deal.stage, company: deal.company, contact: deal.contact, close_date: deal.close_date, last_activity: deal.last_activity })}
Open tasks: ${JSON.stringify(tasks)}
Timeline (newest first): ${JSON.stringify(timeline)}`,
      }],
    });
    const text = msg.content.map((b: any) => b.text ?? '').join('').trim().split('\n')[0];
    if (!text) throw new UserError('Claude returned an empty answer. Try again.');
    db.prepare('UPDATE deals SET nba_text = ?, nba_key = ? WHERE id = ? AND client_id = ?').run(text, key, id, req.scope.clientId);
    res.json({ text, fresh: true });
  } catch (e) {
    const f = e instanceof UserError ? { status: 502, message: e.message } : friendlyError(e);
    res.status(f.status).json({ error: f.message });
  }
});
