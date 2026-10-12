import Anthropic from '@anthropic-ai/sdk';
import { hasApiKey } from './config.js';

export class MissingKeyError extends Error {
  constructor() {
    super('Claude is not set up yet. Add ANTHROPIC_API_KEY to the .env file and restart `npm run dev`.');
  }
}

let client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!hasApiKey()) throw new MissingKeyError();
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
}

/** Turn any Claude/API error into one sentence a non-technical user can act on. */
export function friendlyError(e: unknown): { status: number; message: string } {
  if (e instanceof MissingKeyError) return { status: 503, message: e.message };
  if (e instanceof Anthropic.AuthenticationError)
    return { status: 401, message: 'Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env, then restart.' };
  if (e instanceof Anthropic.PermissionDeniedError)
    return { status: 403, message: "Your API key doesn't have access to this model or feature. Check your Anthropic Console settings." };
  if (e instanceof Anthropic.RateLimitError)
    return { status: 429, message: "You've hit Claude's rate limit. Wait a minute and try again." };
  if (e instanceof Anthropic.NotFoundError)
    return { status: 404, message: 'The configured Claude model was not found. Check MODEL in server/config.ts.' };
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) return { status: 402, message: 'Your Anthropic account is out of credits. Add credits in the Anthropic Console.' };
    if (/web.?search/i.test(e.message)) return { status: 400, message: 'Web search is not enabled for your Anthropic organization. Turn it on in the Anthropic Console (Settings → Privacy/Features).' };
    return { status: 400, message: `Claude rejected the request: ${e.message}` };
  }
  if (e instanceof Anthropic.APIConnectionError)
    return { status: 502, message: "Couldn't reach Anthropic. Check your internet connection and try again." };
  if (e instanceof Anthropic.InternalServerError)
    return { status: 503, message: 'Claude is overloaded or having trouble right now. Try again in a moment.' };
  if (e instanceof Anthropic.APIError && e.status === 402)
    return { status: 402, message: 'Your Anthropic account is out of credits. Add credits in the Anthropic Console.' };
  if (e instanceof Anthropic.APIError)
    return { status: 502, message: `Claude request failed (${e.status ?? 'no status'}). Try again in a moment.` };
  console.error(e);
  return { status: 500, message: 'Something went wrong talking to Claude. Check the server terminal for details.' };
}
