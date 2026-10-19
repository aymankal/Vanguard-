const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const providers = require('./src/providers');
const documents = require('./src/documents');
const store = require('./src/store');
const { markdownToDocx } = require('./src/exporter');

let win;
const running = new Map(); // requestId -> AbortController

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    title: 'Vanguard AI',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links in answers open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

// ---- State ----

async function state() {
  const settings = store.getSettings();
  const keys = store.readKeys();
  const cloud = Object.entries(providers.PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    keyUrl: p.keyUrl,
    hasKey: Boolean(keys[id]),
    models: settings.models[id]?.length ? settings.models[id] : p.models,
  }));
  return { settings, cloud, online: net.isOnline(), ollama: await providers.ollamaStatus(), platform: process.platform, version: app.getVersion() };
}

ipcMain.handle('app:state', state);
ipcMain.handle('app:online', () => net.isOnline());
ipcMain.handle('settings:save', (_e, patch) => store.saveSettings(patch));
ipcMain.handle('keys:set', (_e, provider, key) => {
  store.setKey(provider, (key || '').trim());
  return state();
});

ipcMain.handle('models:refresh', async (_e, provider) => {
  const key = store.readKeys()[provider];
  if (!key) throw new Error('Add a key first');
  const ids = await providers.listCloudModels(provider, key);
  const settings = store.getSettings();
  store.saveSettings({ models: { ...settings.models, [provider]: ids } });
  return ids;
});

ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ---- Documents ----

async function extractAll(paths) {
  const out = [];
  for (const p of paths) {
    try {
      out.push({ ok: true, ...(await documents.extract(p)) });
    } catch (err) {
      out.push({ ok: false, name: path.basename(p), error: err.message });
    }
  }
  return out;
}

ipcMain.handle('files:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: documents.SUPPORTED }],
  });
  return res.canceled ? [] : extractAll(res.filePaths);
});
ipcMain.handle('files:extract', (_e, paths) => extractAll(paths));

ipcMain.handle('export:docx', async (_e, markdown, title) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${(title || 'Vanguard AI answer').replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.docx`,
    filters: [{ name: 'Word document', extensions: ['docx'] }],
  });
  if (res.canceled) return false;
  await fs.writeFile(res.filePath, await markdownToDocx(markdown, title));
  shell.showItemInFolder(res.filePath);
  return true;
});

ipcMain.handle('export:md', async (_e, markdown, title) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${(title || 'Vanguard AI answer').replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
  });
  if (res.canceled) return false;
  await fs.writeFile(res.filePath, markdown, 'utf8');
  return true;
});

// ---- Chats ----

ipcMain.handle('chats:get', () => store.getChats());
ipcMain.handle('chats:save', (_e, chats) => store.saveChats(chats));

// ---- Local models ----

ipcMain.handle('ollama:status', () => providers.ollamaStatus());
ipcMain.handle('ollama:delete', (_e, name) => providers.ollamaDelete(name));
ipcMain.handle('ollama:pull', async (e, name) => {
  await providers.ollamaPull(name, (p) => e.sender.send('ollama:progress', { name, ...p }));
  return providers.ollamaStatus();
});

// ---- Chat ----

// How much document text each kind of model gets, in characters (about 4 per token).
// Cloud is capped well below the context limit to keep each question affordable.
const DOC_BUDGET = { anthropic: 600_000, google: 600_000, openai: 300_000, openrouter: 300_000, default: 200_000 };
const LOCAL_DOC_BUDGET = Math.floor((providers.LOCAL_CONTEXT_TOKENS - 4000) * 3);

function systemPrompt(settings, docContext, trimmed, offline) {
  const lines = [
    'You are Vanguard AI, a sharp, practical assistant for Vanguard Services SAL, a Beirut-based outsourcing and BPO company (SDR teams, sales outsourcing, customer support).',
    'Be direct and concise. Use Markdown headings, bullets and tables when they make an answer easier to use.',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ];
  if (offline) lines.push('You are running offline on a local model: you cannot browse the web, and should say so if asked for current events.');
  if (docContext) {
    lines.push('The user attached the documents below. Answer from them, quote exact wording when it matters, and cite page or sheet references like [Page 3]. If the documents do not contain the answer, say so plainly before adding anything from general knowledge.');
    if (trimmed) lines.push('The documents were too long to include whole; you are seeing the passages most relevant to the question, separated by […]. Mention this if the answer may depend on parts not shown.');
  }
  if (settings.systemPrompt?.trim()) lines.push(`User instructions: ${settings.systemPrompt.trim()}`);
  return lines.join('\n') + (docContext ? `\n\n${docContext}` : '');
}

function pickLocalModel(settings, ollama) {
  const names = ollama.models.map((m) => m.name);
  if (settings.localModel && names.includes(settings.localModel)) return settings.localModel;
  return names[0];
}

ipcMain.handle('chat:stop', (_e, requestId) => running.get(requestId)?.abort());

ipcMain.handle('chat:send', async (e, { requestId, model, messages, docs }) => {
  const send = (type, data = {}) => !e.sender.isDestroyed() && e.sender.send('chat:event', { requestId, type, ...data });
  const settings = store.getSettings();
  const controller = new AbortController();
  running.set(requestId, controller);
  let target = { ...model };
  try {
    const online = net.isOnline();
    if (target.provider !== 'ollama' && !online) {
      if (!settings.autoOffline) throw new Error('You are offline. Switch to a local model, or turn on "Use a local model when offline" in Settings.');
      const ollama = await providers.ollamaStatus();
      const local = pickLocalModel(settings, ollama);
      if (!ollama.running || !local) throw new Error('You are offline and no local model is ready. Install Ollama and download a model in Settings → Offline models while you have internet.');
      target = { provider: 'ollama', id: local };
      send('route', { model: target, reason: 'Offline: answered by your local model' });
    }

    const local = target.provider === 'ollama';
    const question = messages[messages.length - 1]?.content || '';
    const budget = local ? LOCAL_DOC_BUDGET : (DOC_BUDGET[target.provider] || DOC_BUDGET.default);
    const { context, trimmed } = documents.buildContext(docs || [], question, budget);
    if (trimmed) send('status', { text: local ? 'Long document: reading the most relevant passages' : 'Very long document: sending the most relevant passages' });
    const system = systemPrompt(settings, context, trimmed, local);
    // Local models have a small window, so they see the recent turns only.
    const history = (local ? messages.slice(-8) : messages).map((m) => ({ role: m.role, content: m.content }));

    const onText = (text) => send('text', { text });
    const onStatus = (text) => send('status', { text });
    const signal = controller.signal;

    if (local) {
      await providers.streamOllama({ model: target.id, system, messages: history, signal, onText });
    } else {
      const apiKey = store.readKeys()[target.provider];
      if (!apiKey) throw new Error(`No API key for ${providers.PROVIDERS[target.provider]?.label || target.provider}. Add one in Settings.`);
      if (target.provider === 'anthropic') {
        await providers.streamAnthropic({ apiKey, model: target.id, system, messages: history, webSearch: settings.webSearch, signal, onText, onStatus });
      } else {
        await providers.streamOpenAICompatible({ provider: target.provider, apiKey, model: target.id, system, messages: history, signal, onText });
      }
    }
    send('done', { model: target });
  } catch (err) {
    if (controller.signal.aborted) send('done', { model: target, stopped: true });
    else send('error', { message: friendlyError(err) });
  } finally {
    running.delete(requestId);
  }
});

function friendlyError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) return 'The API key was rejected. Check it in Settings.';
  if (status === 404) return 'That model is not available on your account. Pick another, or refresh the model list in Settings.';
  if (status === 429) return 'Rate limit or credit limit reached on this provider. Wait a moment, check billing, or switch model.';
  if (status >= 500) return 'The provider is having trouble right now. Try again or switch model.';
  if (err?.name === 'APIConnectionError' || /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(err?.message || '')) return 'Could not reach the provider. Check your connection, or switch to a local model.';
  return err?.message || String(err);
}
