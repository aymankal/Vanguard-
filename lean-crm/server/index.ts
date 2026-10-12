import { PORT, MODEL, hasApiKey } from './config.js';
import { seedIfEmpty } from './seed.js';
import { createApp } from './app.js';
import { startScheduler } from './reports.js';

seedIfEmpty();
startScheduler();

createApp().listen(PORT, () => {
  console.log(`Lean CRM API on http://localhost:${PORT}  (model: ${MODEL})`);
  if (!hasApiKey()) console.warn('⚠  ANTHROPIC_API_KEY is not set. The CRM works; AI features will ask you to add the key.');
});
