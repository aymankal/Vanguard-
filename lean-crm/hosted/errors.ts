// Hosted replacement for server/errors.ts: Claude runs through the viewer's claude.ai account
// (the `sample` capability) instead of an API key. claude() mimics the few SDK calls the
// server code makes (plain messages, optionally with a JSON schema).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { caps } from './caps';
import { MODEL } from './config';

export class MissingKeyError extends Error {
  constructor() {
    super('Claude isn’t available on this page. Allow Claude from the page’s Permissions menu, then try again.');
  }
}

type Msg = { role: 'user' | 'assistant'; content: string | { type: string; text?: string }[] };
const text = (c: Msg['content']) => (typeof c === 'string' ? c : c.map((b) => b.text ?? '').join(''));

export function claude() {
  const sample = caps.sample;
  if (!sample) throw new MissingKeyError();
  return {
    models: { retrieve: async () => ({ id: MODEL }) },
    beta: {
      messages: {
        async create(params: any) {
          const input = (params.messages as Msg[]).map((m) => ({ role: m.role, content: text(m.content) }));
          const opts = { model: MODEL, modelTier: 'default', cache: false };
          const schema = params.output_config?.format?.schema;
          if (schema) {
            input[input.length - 1] = { ...input[input.length - 1], content: `${input[input.length - 1].content}\n\nReply with only a JSON value matching this JSON Schema, nothing else:\n${JSON.stringify(schema)}` };
            const value = await sample.json(input, opts);
            return { content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn' };
          }
          const r = await sample(input, opts);
          return { content: [{ type: 'text', text: r.text }], stop_reason: 'end_turn' };
        },
      },
    },
  };
}

const COPY: Record<string, [number, string]> = {
  not_granted: [403, 'Claude isn’t allowed on this page yet. Allow it from the page’s Permissions menu, then try again.'],
  sampling_disabled: [403, 'Claude isn’t available for this account.'],
  not_declared: [403, 'This page no longer has Claude access.'],
  rate_limited: [429, 'You’ve hit Claude’s usage limit for now. Wait a minute and try again.'],
  session_expired: [401, 'Your claude.ai session expired. Sign in again and reload.'],
  refused: [400, 'Claude declined that request.'],
  prompt_too_large: [400, 'That request is too large for Claude. Try a smaller one.'],
  tools_unavailable: [400, 'This view can’t run Claude tools. Open the page in claude.ai.'],
  invalid_json: [502, 'Claude’s answer couldn’t be read. Try again.'],
  empty_completion: [502, 'Claude returned an empty answer. Try again.'],
  upstream_error: [503, 'Claude is having trouble right now. Try again in a moment.'],
};

export function friendlyError(e: unknown): { status: number; message: string } {
  if (e instanceof MissingKeyError) return { status: 503, message: e.message };
  const code = (e as { code?: string })?.code;
  if (code && COPY[code]) return { status: COPY[code][0], message: COPY[code][1] };
  if (code === 'cancelled') return { status: 499, message: 'Stopped.' };
  console.error(e);
  return { status: 500, message: 'Something went wrong talking to Claude. Try again.' };
}
