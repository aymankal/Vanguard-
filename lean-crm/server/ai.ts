import { Router, type Request, type Response } from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODEL, CHAT_MAX_ROUNDS, RESEARCH_MAX_SEARCHES, SELLER_PITCH, hasApiKey } from './config.js';
import { db, DEAL_SELECT, today, nbaKey, type Row } from './db.js';
import { claude, friendlyError } from './errors.js';
import { TOOLS, isWriteTool, writeSchemas, dryRun, applyActions, summarize, runReadTool, type Action, type WriteTool } from './aiTools.js';
import { UserError } from './store.js';

export const ai = Router();

// Server-side refusal fallback: if the model declines, the API retries on a fallback model in the same call.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

/** Open a Server-Sent Events stream; returns a send() helper and an AbortController tied to the client. */
function sse(req: Request, res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const send = (data: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  return { send, abort, end: () => res.end() };
}

// ---------- Status (Settings → API key check) ----------
ai.get('/status', async (_req, res) => {
  if (!hasApiKey()) return res.json({ ok: false, model: MODEL, message: 'No ANTHROPIC_API_KEY in .env. Add it and restart.' });
  try {
    await claude().models.retrieve(MODEL);
    res.json({ ok: true, model: MODEL, message: `Connected. Using ${MODEL}.` });
  } catch (e) {
    res.json({ ok: false, model: MODEL, message: friendlyError(e).message });
  }
});

// ---------- Command bar ----------
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

ai.post('/chat', async (req, res) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad chat request.' });
  const { send, abort, end } = sse(req, res);

  const stages = (db.prepare('SELECT name FROM stages ORDER BY position').all() as { name: string }[]).map((s) => s.name);
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Today is ${weekday} ${today()}. Pipeline stages, in order: ${stages.join(', ')}.` },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = parsed.data.messages.map((m) => ({ role: m.role, content: m.content }));
  const proposals: Action[] = [];
  let wroteText = false;

  try {
    for (let round = 0; round < CHAT_MAX_ROUNDS; round++) {
      if (wroteText) send({ type: 'text', text: '\n\n' });
      const stream = claude().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          system,
          tools: TOOLS,
          messages,
          output_config: { effort: 'medium' },
          ...FALLBACK,
        },
        { signal: abort.signal },
      );
      stream.on('text', (t) => {
        wroteText = true;
        send({ type: 'text', text: t });
      });
      const msg = await stream.finalMessage();

      if (msg.stop_reason === 'refusal') {
        send({ type: 'text', text: "I can't help with that request." });
        break;
      }
      if (msg.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: msg.content });
        continue;
      }
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!uses.length) break;
      if (msg.stop_reason === 'max_tokens') {
        send({ type: 'error', message: 'That request was too long for one go. Try splitting it up.' });
        break;
      }
      messages.push({ role: 'assistant', content: msg.content });

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        try {
          if (isWriteTool(u.name)) {
            const tool: WriteTool = u.name;
            const check = writeSchemas[tool].safeParse(u.input);
            if (!check.success) throw new UserError(check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
            const action: Action = { tool, input: check.data as Row, summary: summarize(tool, check.data as Row) };
            const problem = dryRun([...proposals, action]);
            if (problem) throw new UserError(problem);
            proposals.push(action);
            send({ type: 'proposal', action });
            results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Queued for the user to confirm. Not saved yet.' });
          } else {
            send({ type: 'status', text: u.name === 'search_records' ? 'Searching…' : 'Reading account…' });
            results.push({ type: 'tool_result', tool_use_id: u.id, content: runReadTool(u.name, u.input) });
          }
        } catch (e) {
          const message = e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : (e as Error).message;
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: message });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    send({ type: 'done' });
  } catch (e) {
    if (!abort.signal.aborted) send({ type: 'error', message: friendlyError(e).message });
  }
  end();
});

const ApplyBody = z.object({
  actions: z.array(z.object({ tool: z.enum(Object.keys(writeSchemas) as [WriteTool, ...WriteTool[]]), input: z.record(z.string(), z.unknown()) })).min(1).max(30),
});
ai.post('/apply', (req, res) => {
  const parsed = ApplyBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Nothing to apply.' });
  try {
    res.json({ applied: applyActions(parsed.data.actions as { tool: WriteTool; input: Row }[]) });
  } catch (e) {
    const msg = e instanceof z.ZodError ? 'One of the changes is incomplete.' : (e as Error).message;
    res.status(400).json({ error: `Nothing was saved: ${msg}` });
  }
});

// ---------- Research ----------
const ResearchBody = z.object({ kind: z.enum(['company', 'contact']), id: z.number().int() });

ai.post('/research', async (req, res) => {
  const parsed = ResearchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad research request.' });
  const { kind, id } = parsed.data;

  let subject: string;
  if (kind === 'company') {
    const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Row | undefined;
    if (!c) return res.status(404).json({ error: 'Company not found.' });
    subject = `Company: ${c.name}${c.website ? ` (website: ${c.website})` : ''}${c.industry ? `, industry: ${c.industry}` : ''}.`;
  } else {
    const c = db.prepare('SELECT c.*, co.name company, co.website FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = ?').get(id) as Row | undefined;
    if (!c) return res.status(404).json({ error: 'Contact not found.' });
    subject = `Person: ${c.name}${c.title ? `, ${c.title}` : ''}${c.company ? ` at ${c.company}` : ''}${c.website ? ` (${c.website})` : ''}${c.email ? `, email ${c.email}` : ''}.`;
  }

  const { send, abort, end } = sse(req, res);
  const prompt = `Research this sales prospect on the web and write a brief for a seller.

${subject}

What we sell: ${SELLER_PITCH}

Output ONLY the brief in Markdown with exactly these sections, no intro, no narration of your searches:
## What they do
2-3 sentences.
## Size
Employees, revenue/funding, locations if known. Say "Unknown" rather than guess.
## Recent news
Up to 3 bullets with dates.
## Likely pain points
3 bullets tied to what we sell.
## Talking points
Exactly 3 numbered points.
## Draft first outreach
A short email (subject line + under 120 words), specific to them, one clear ask. ${kind === 'contact' ? 'Address the person by first name.' : ''}

If the web has little on them, say so plainly. Today is ${today()}.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  try {
    let final: Anthropic.Beta.BetaMessage | null = null;
    const content: Anthropic.Beta.BetaContentBlock[] = [];
    for (let i = 0; i < 4; i++) {
      const stream = claude().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: RESEARCH_MAX_SEARCHES }],
          messages,
          output_config: { effort: 'medium' },
          ...FALLBACK,
        },
        { signal: abort.signal },
      );
      stream.on('text', (t) => send({ type: 'text', text: t }));
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_start' && ev.content_block.type === 'server_tool_use') send({ type: 'status', text: 'Searching the web…' });
      });
      final = await stream.finalMessage();
      content.push(...final.content);
      if (final.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: final.content });
    }
    if (final?.stop_reason === 'refusal') {
      send({ type: 'error', message: "Claude declined to research this one." });
      return end();
    }
    send({ type: 'final', ...buildBrief(content) });
  } catch (e) {
    if (!abort.signal.aborted) send({ type: 'error', message: friendlyError(e).message });
  }
  end();
});

/** Assemble the brief from text after the last search, number cited sources, fall back to raw results. */
function buildBrief(content: Anthropic.Beta.BetaContentBlock[]) {
  let lastSearch = -1;
  content.forEach((b, i) => {
    if (b.type === 'web_search_tool_result') lastSearch = i;
  });
  const sources: { url: string; title: string }[] = [];
  const indexOf = (url: string, title: string | null) => {
    let n = sources.findIndex((s) => s.url === url);
    if (n === -1) n = sources.push({ url, title: title || url }) - 1;
    return n + 1;
  };
  let markdown = '';
  for (const b of content.slice(lastSearch + 1)) {
    if (b.type !== 'text') continue;
    markdown += b.text;
    const nums = new Set<number>();
    for (const c of b.citations ?? []) if (c.type === 'web_search_result_location') nums.add(indexOf(c.url, c.title));
    if (nums.size) markdown += ' ' + [...nums].map((n) => `[${n}](${sources[n - 1].url})`).join(' ');
  }
  // No citations? Show what was searched so the user can still verify.
  if (!sources.length) {
    for (const b of content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.type === 'web_search_result') indexOf(r.url, r.title);
      }
    }
  }
  return { markdown: markdown.trim(), sources: sources.slice(0, 12) };
}

// ---------- Next best action (cached per deal; key changes when the timeline does) ----------
ai.get('/nba/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db.prepare('SELECT nba_text, nba_key FROM deals WHERE id = ?').get(id) as Row | undefined;
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  res.json({ text: d.nba_text ?? null, fresh: !!d.nba_text && d.nba_key === nbaKey(id) });
});

ai.post('/nba/:id', async (req, res) => {
  const id = Number(req.params.id);
  const deal = db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id) as Row | undefined;
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  const key = nbaKey(id);
  if (deal.nba_text && deal.nba_key === key && !req.query.force) return res.json({ text: deal.nba_text, fresh: true });

  const timeline = db.prepare('SELECT type, body, created_at FROM activities WHERE deal_id = ? ORDER BY created_at DESC LIMIT 30').all(id);
  const tasks = db.prepare('SELECT title, due_date FROM tasks WHERE deal_id = ? AND done = 0').all(id);
  const stages = (db.prepare('SELECT name FROM stages ORDER BY position').all() as Row[]).map((s) => s.name).join(' → ');
  try {
    const msg = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      ...FALLBACK,
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
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim().split('\n')[0];
    if (!text) throw new Error('empty');
    db.prepare('UPDATE deals SET nba_text = ?, nba_key = ? WHERE id = ?').run(text, key, id);
    res.json({ text, fresh: true });
  } catch (e) {
    const f = friendlyError(e);
    res.status(f.status).json({ error: f.message });
  }
});
