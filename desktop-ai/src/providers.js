// Model providers. Cloud models need a key and a connection; local models run through Ollama
// on this machine and work with no internet at all.
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const OLLAMA_URL = 'http://127.0.0.1:11434';

// Starting lists. "Refresh models" in Settings replaces each cloud list with what the
// provider's API actually offers this key, so new flagships show up without an app update.
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  openai: {
    label: 'OpenAI (GPT)',
    keyUrl: 'https://platform.openai.com/api-keys',
    baseURL: 'https://api.openai.com/v1',
    models: [],
  },
  google: {
    label: 'Google (Gemini)',
    keyUrl: 'https://aistudio.google.com/apikey',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: [],
  },
  xai: {
    label: 'xAI (Grok)',
    keyUrl: 'https://console.x.ai',
    baseURL: 'https://api.x.ai/v1',
    models: [],
  },
  deepseek: {
    label: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    baseURL: 'https://api.deepseek.com',
    models: [],
  },
  mistral: {
    label: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    baseURL: 'https://api.mistral.ai/v1',
    models: [],
  },
  openrouter: {
    label: 'OpenRouter (any model, one key)',
    keyUrl: 'https://openrouter.ai/keys',
    baseURL: 'https://openrouter.ai/api/v1',
    models: [],
  },
};

// Chat models only: provider model lists also carry embedding, audio, image and moderation models.
const NON_CHAT = /embed|whisper|tts|audio|realtime|transcribe|dall-e|image|moderation|search-preview|babbage|davinci|aqa|imagen|veo/i;

async function listCloudModels(provider, apiKey) {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const ids = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  }
  const p = PROVIDERS[provider];
  const client = new OpenAI({ apiKey, baseURL: p.baseURL });
  const ids = [];
  for await (const m of client.models.list()) ids.push(m.id.replace(/^models\//, ''));
  return ids.filter((id) => !NON_CHAT.test(id)).sort().reverse();
}

// Claude models that take the dynamic-filtering web search tool.
const WEB_SEARCH_MODELS = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6)|fable-5)/;

async function streamAnthropic({ apiKey, model, system, messages, webSearch, signal, onText, onStatus }) {
  const client = new Anthropic({ apiKey });
  const tools = webSearch && WEB_SEARCH_MODELS.test(model)
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]
    : undefined;
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  // Web search can pause a long turn; send it back to let the model carry on (a few rounds at most).
  for (let round = 0; round < 4; round++) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      system,
      messages: convo,
      tools,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal });
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
        onStatus('Searching the web…');
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onText(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      onText('\n\n_The model declined this request._');
      return;
    }
    if (final.stop_reason === 'max_tokens') onText('\n\n_Answer cut off at the length limit._');
    if (final.stop_reason !== 'pause_turn') return;
    convo.push({ role: 'assistant', content: final.content });
  }
}

async function streamOpenAICompatible({ provider, apiKey, model, system, messages, signal, onText }) {
  const client = new OpenAI({ apiKey, baseURL: PROVIDERS[provider].baseURL });
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [{ role: 'system', content: system }, ...messages],
  }, { signal });
  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) onText(text);
  }
}

// ---- Ollama (offline) ----

async function ollamaStatus() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { running: false, models: [] };
    const data = await res.json();
    return { running: true, models: (data.models || []).map((m) => ({ name: m.name, size: m.size })) };
  } catch {
    return { running: false, models: [] };
  }
}

// Reads Ollama's newline-delimited JSON stream, one object per line.
async function* ndjson(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

async function ollamaPull(name, onProgress, signal) {
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama could not download ${name} (${res.status})`);
  for await (const msg of ndjson(res.body)) {
    if (msg.error) throw new Error(msg.error);
    onProgress({ status: msg.status, completed: msg.completed, total: msg.total });
  }
}

async function ollamaDelete(name) {
  const res = await fetch(`${OLLAMA_URL}/api/delete`, { method: 'DELETE', body: JSON.stringify({ model: name }) });
  if (!res.ok) throw new Error(`Could not remove ${name}`);
}

// Local context window. Bigger reads more of a document but needs more memory.
const LOCAL_CONTEXT_TOKENS = 16384;

async function streamOllama({ model, system, messages, signal, onText }) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model,
        stream: true,
        options: { num_ctx: LOCAL_CONTEXT_TOKENS },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal,
    });
  } catch {
    throw new Error('Ollama is not running. Install it from ollama.com (or start it), then try again.');
  }
  if (!res.ok) throw new Error(`Local model error: ${await res.text()}`);
  for await (const msg of ndjson(res.body)) {
    if (msg.error) throw new Error(msg.error);
    if (msg.message?.content) onText(msg.message.content);
  }
}

module.exports = {
  PROVIDERS,
  LOCAL_CONTEXT_TOKENS,
  listCloudModels,
  streamAnthropic,
  streamOpenAICompatible,
  streamOllama,
  ollamaStatus,
  ollamaPull,
  ollamaDelete,
};
