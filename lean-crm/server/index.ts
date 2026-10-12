import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { PORT, MODEL, hasApiKey } from './config.js';
import { seedIfEmpty } from './seed.js';
import { api } from './api.js';
import { ai } from './ai.js';

seedIfEmpty();

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/ai', ai);
app.use('/api', api);

// Production: serve the built client.
const dist = new URL('../dist', import.meta.url).pathname;
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Lean CRM API on http://localhost:${PORT}  (model: ${MODEL})`);
  if (!hasApiKey()) console.warn('⚠  ANTHROPIC_API_KEY is not set. The CRM works; AI features will ask you to add the key.');
});
