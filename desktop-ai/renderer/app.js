/* global marked, DOMPurify */
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};

const NAMES = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-fable-5-1': 'Claude Fable 5.1',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

// Local models worth downloading, smallest first. Any Ollama model name also works.
const RECOMMENDED = [
  { name: 'gemma3:4b', size: '3.3 GB', note: 'Light and quick. Fine on 8 GB RAM laptops.' },
  { name: 'qwen3:8b', size: '5.2 GB', note: 'Best all-round document model for 16 GB RAM.' },
  { name: 'llama3.1:8b', size: '4.9 GB', note: 'Solid writing and summaries, 16 GB RAM.' },
  { name: 'gpt-oss:20b', size: '14 GB', note: "OpenAI's open-weight model. Strongest here; 24 GB+ RAM or a good GPU." },
];

let app = null; // state from the main process
// Phones: Enter adds a new line and the Send button sends.
const touch = matchMedia('(pointer: coarse)').matches;
// On Android, offline models run inside the app instead of through Ollama.
const onDevice = () => app?.local?.kind === 'device';
let chats = [];
let current = null;
let pending = []; // docs attached before the first message of a new chat
let active = null; // { requestId, chat, msg, node }

marked.setOptions({ gfm: true, breaks: true });
const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const modelName = (m) => (m.provider === 'ollama' ? `${m.id} (local)` : NAMES[m.id] || m.id);
const fmtSize = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

// ---------- Boot ----------

async function boot() {
  app = await window.api.state();
  chats = await window.api.getChats();
  renderPicker();
  renderNet(app.online);
  renderChatList();
  openChat(chats[0]?.id || null);
  if (touch) $('#hint').textContent = 'Documents stay with this chat';
  if (touch || matchMedia('(max-width: 700px)').matches) $('#input').placeholder = 'Ask anything…';
  setInterval(async () => renderNet(await window.api.online()), 5000);
  window.addEventListener('online', async () => renderNet(await window.api.online()));
  window.addEventListener('offline', () => renderNet(false));
  if (!app.cloud.some((p) => p.hasKey) && !app.ollama.models.length) openSettings();
}

function renderNet(online) {
  const b = $('#netBadge');
  b.textContent = online ? '● Online' : '● Offline';
  b.className = `badge ${online ? 'online' : 'offline'}`;
  b.title = online ? 'Cloud models available' : app.settings.autoOffline ? 'Cloud questions go to your local model' : 'Pick a local model';
}

// ---------- Model picker ----------

function renderPicker() {
  const sel = $('#modelPicker');
  sel.innerHTML = '';
  const withKeys = app.cloud.filter((p) => p.hasKey);
  for (const p of withKeys) {
    const group = el('optgroup', { label: p.label });
    const models = p.models.length ? p.models : [];
    if (!models.length) group.append(el('option', { disabled: true, textContent: 'Refresh models in Settings' }));
    for (const id of models) group.append(el('option', { value: `${p.id}|${id}`, textContent: NAMES[id] || id }));
    sel.append(group);
  }
  const local = el('optgroup', { label: onDevice() ? 'On this phone (works offline)' : 'On this computer (works offline)' });
  if (app.ollama.models.length) {
    for (const m of app.ollama.models) local.append(el('option', { value: `ollama|${m.name}`, textContent: m.name }));
  } else {
    local.append(el('option', { disabled: true, textContent: app.ollama.running ? 'Download a model in Settings' : 'Install Ollama (Settings)' }));
  }
  sel.append(local);
  if (!withKeys.length) sel.prepend(el('option', { disabled: true, textContent: 'Add an API key in Settings for Claude, GPT, Gemini…' }));
  const want = `${app.settings.model.provider}|${app.settings.model.id}`;
  if ([...sel.options].some((o) => o.value === want && !o.disabled)) sel.value = want;
  else {
    const first = [...sel.options].find((o) => !o.disabled);
    if (first) sel.value = first.value;
    else sel.selectedIndex = 0;
  }
}

function selectedModel() {
  const [provider, ...rest] = ($('#modelPicker').value || '').split('|');
  return provider ? { provider, id: rest.join('|') } : null;
}

$('#modelPicker').addEventListener('change', async () => {
  const model = selectedModel();
  if (model) app.settings = await window.api.saveSettings({ model });
});

// ---------- Chats ----------

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.saveChats(chats), 300);
}

function renderChatList() {
  const q = $('#chatSearch').value.trim().toLowerCase();
  const list = $('#chatList');
  list.innerHTML = '';
  for (const c of chats) {
    if (q && !c.title.toLowerCase().includes(q) && !c.messages.some((m) => m.content.toLowerCase().includes(q))) continue;
    const del = el('button', { className: 'del', title: 'Delete chat', textContent: '✕' });
    const item = el('div', { className: `chat-item${current?.id === c.id ? ' active' : ''}` }, el('span', { className: 'title', textContent: c.title }), del);
    item.addEventListener('click', () => openChat(c.id));
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${c.title}"?`)) return;
      chats = chats.filter((x) => x.id !== c.id);
      persist();
      if (current?.id === c.id) openChat(chats[0]?.id || null);
      else renderChatList();
    });
    list.append(item);
  }
}
$('#chatSearch').addEventListener('input', renderChatList);

const closeDrawer = () => document.body.classList.remove('drawer-open');
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
$('#scrim').addEventListener('click', closeDrawer);

function openChat(id) {
  closeDrawer();
  current = chats.find((c) => c.id === id) || null;
  pending = [];
  renderChatList();
  renderMessages();
  renderChips();
  if (!touch) $('#input').focus();
}

$('#newChat').addEventListener('click', () => openChat(null));

function docsInView() {
  return current ? current.docs : pending;
}

// ---------- Messages ----------

function renderMessages() {
  const box = $('#messages');
  box.querySelectorAll('.msg').forEach((n) => n.remove());
  $('#empty').classList.toggle('hidden', Boolean(current?.messages.length));
  if (!current) return;
  for (const m of current.messages) box.append(messageNode(m));
  box.scrollTop = box.scrollHeight;
}

function messageNode(m) {
  const bubble = el('div', { className: 'bubble' });
  if (m.role === 'user') bubble.textContent = m.content;
  else bubble.innerHTML = md(m.content);
  const node = el('div', { className: `msg ${m.role}` }, bubble);
  if (m.role === 'assistant') {
    const meta = el('div', { className: 'meta' });
    node.append(meta);
    fillMeta(meta, m);
  }
  return node;
}

function fillMeta(meta, m) {
  meta.innerHTML = '';
  if (m.error) meta.append(el('span', { className: 'error', textContent: `⚠ ${m.error}` }));
  if (m.model) meta.append(el('span', { className: 'muted small', textContent: modelName(m.model) + (m.routed ? ' · offline fallback' : '') }));
  if (!m.content) return;
  const copy = el('button', { textContent: 'Copy' });
  copy.addEventListener('click', async () => {
    await (window.api.copy ? window.api.copy(m.content) : navigator.clipboard.writeText(m.content));
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy'), 1200);
  });
  const word = el('button', { textContent: 'Save as Word' });
  word.addEventListener('click', () => window.api.exportDocx(m.content, current?.title));
  const mdBtn = el('button', { textContent: 'Save as text' });
  mdBtn.addEventListener('click', () => window.api.exportMd(m.content, current?.title));
  meta.append(copy, word, mdBtn);
}

// ---------- Documents ----------

function renderChips() {
  const box = $('#docChips');
  box.innerHTML = '';
  for (const d of docsInView()) {
    const x = el('button', { title: 'Remove', textContent: '✕' });
    x.addEventListener('click', () => {
      const list = docsInView();
      list.splice(list.indexOf(d), 1);
      if (current) persist();
      renderChips();
    });
    const info = d.pages ? `${d.pages} pages` : `${Math.round(d.chars / 1000)}k chars`;
    box.append(el('span', { className: 'chip', title: d.name }, `📄 ${d.name} · ${info}`, x));
  }
}

function addDocs(results) {
  const list = docsInView();
  for (const r of results) {
    if (!r.ok) {
      alert(`${r.name}: ${r.error}`);
      continue;
    }
    const existing = list.findIndex((d) => d.name === r.name);
    const doc = { name: r.name, chars: r.chars, pages: r.pages, text: r.text };
    if (existing >= 0) list[existing] = doc;
    else list.push(doc);
  }
  if (current) persist();
  renderChips();
}

$('#attach').addEventListener('click', async () => {
  $('#attach').disabled = true;
  try {
    addDocs(await window.api.pickFiles());
  } finally {
    $('#attach').disabled = false;
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  $('#dropOverlay').classList.remove('hidden');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropOverlay').classList.add('hidden');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').classList.add('hidden');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) addDocs(await window.api.extractFiles(files));
});

// ---------- Sending ----------

const input = $('#input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch) {
    e.preventDefault();
    send();
  }
});
$('#send').addEventListener('click', send);
$('#stop').addEventListener('click', () => active && window.api.stop(active.requestId));
document.querySelectorAll('.starters button').forEach((b) =>
  b.addEventListener('click', () => {
    input.value = b.dataset.prompt;
    if (!touch) input.focus();
    if (!docsInView().length) $('#attach').click();
  }));

function setBusy(busy) {
  $('#send').classList.toggle('hidden', busy);
  $('#stop').classList.toggle('hidden', !busy);
}

async function send() {
  const text = input.value.trim();
  if (!text || active) return;
  const model = selectedModel();
  if (!model) {
    openSettings();
    return;
  }
  if (!current) {
    current = { id: uid(), title: text.slice(0, 60), created: Date.now(), docs: pending, messages: [] };
    pending = [];
    chats.unshift(current);
  } else {
    // Most recent chat first.
    chats = [current, ...chats.filter((c) => c.id !== current.id)];
  }
  input.value = '';
  input.style.height = 'auto';
  current.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', model };
  current.messages.push(reply);
  current.updated = Date.now();
  persist();
  renderChatList();
  renderMessages();
  $('#routeNote').textContent = '';

  const node = $('#messages').lastElementChild;
  const bubble = node.querySelector('.bubble');
  bubble.classList.add('cursor');
  const requestId = uid();
  active = { requestId, chat: current, msg: reply, node };
  setBusy(true);
  const history = current.messages.slice(0, -1).filter((m) => m.content && !m.error);
  await window.api.send({ requestId, model, messages: history, docs: current.docs });
}

let paintQueued = false;
function paint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    if (!active) return;
    const box = $('#messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (current === active.chat) {
      active.node.querySelector('.bubble').innerHTML = md(active.msg.content);
      if (atBottom) box.scrollTop = box.scrollHeight;
    }
  });
}

window.api.onChatEvent((ev) => {
  if (!active || ev.requestId !== active.requestId) return;
  const { msg, node } = active;
  const visible = current === active.chat;
  if (ev.type === 'text') {
    msg.content += ev.text;
    paint();
  } else if (ev.type === 'status') {
    if (visible && !msg.content) node.querySelector('.bubble').innerHTML = `<span class="status">${DOMPurify.sanitize(ev.text)}</span>`;
    $('#routeNote').textContent = ev.text;
  } else if (ev.type === 'route') {
    msg.model = ev.model;
    msg.routed = true;
    $('#routeNote').textContent = ev.reason;
  } else if (ev.type === 'done' || ev.type === 'error') {
    if (ev.type === 'error') msg.error = ev.message;
    if (ev.model) msg.model = ev.model;
    if (ev.stopped) msg.content += msg.content ? '\n\n_Stopped._' : '_Stopped._';
    const bubble = node.querySelector('.bubble');
    bubble.classList.remove('cursor');
    if (visible) {
      bubble.innerHTML = md(msg.content);
      fillMeta(node.querySelector('.meta'), msg);
    }
    active.chat.updated = Date.now();
    active = null;
    setBusy(false);
    persist();
    if (ev.type === 'done' && !ev.stopped) $('#routeNote').textContent = '';
  }
});

// ---------- Settings ----------

const dlg = $('#settings');
$('#openSettings').addEventListener('click', () => {
  closeDrawer();
  openSettings();
});

async function openSettings() {
  app = await window.api.state();
  renderSettings();
  if (!dlg.open) dlg.showModal();
}

dlg.addEventListener('close', async () => {
  app.settings = await window.api.saveSettings({
    autoOffline: $('#autoOffline').checked,
    webSearch: $('#webSearch').checked,
    localModel: $('#localDefault').value,
    systemPrompt: $('#systemPrompt').value,
  });
  app = await window.api.state();
  renderPicker();
  renderNet(await window.api.online());
});

function renderSettings() {
  const rows = $('#keyRows');
  rows.innerHTML = '';
  for (const p of app.cloud) {
    const link = el('a', { textContent: 'Get a key ↗' });
    link.addEventListener('click', () => window.api.openExternal(p.keyUrl));
    const keyInput = el('input', { type: 'password', placeholder: p.hasKey ? '•••••••• saved' : 'Paste API key' });
    const save = el('button', { type: 'button', textContent: p.hasKey ? 'Replace' : 'Save' });
    const refresh = el('button', { type: 'button', textContent: p.hasKey ? `Refresh (${p.models.length})` : 'Refresh', disabled: !p.hasKey });
    save.addEventListener('click', async () => {
      const value = keyInput.value.trim();
      if (!value && p.hasKey && !confirm(`Remove the ${p.label} key?`)) return;
      app = await window.api.setKey(p.id, value);
      if (value && app.online) {
        try {
          await window.api.refreshModels(p.id);
        } catch (err) {
          alert(`Key saved, but listing models failed: ${err.message.replace(/^Error invoking remote method '[^']+': /, '')}`);
        }
      }
      app = await window.api.state();
      renderSettings();
      renderPicker();
    });
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      refresh.textContent = 'Loading…';
      try {
        await window.api.refreshModels(p.id);
      } catch (err) {
        alert(err.message.replace(/^Error invoking remote method '[^']+': /, ''));
      }
      app = await window.api.state();
      renderSettings();
      renderPicker();
    });
    rows.append(el('div', { className: 'keyrow' }, el('div', { className: 'label' }, p.label, link), keyInput, save, refresh));
  }

  const o = app.ollama;
  const device = onDevice();
  const st = $('#ollamaState');
  st.innerHTML = '';
  if (device) {
    st.append(
      el('span', { className: o.models.length ? 'ok' : 'warn', textContent: o.models.length ? '● Ready offline. ' : '● No offline model yet. ' }),
      'Offline answers come from a small AI model stored on this phone. Download one on Wi-Fi; it then works anywhere, even in airplane mode. Phone models are much smaller than Claude or GPT, so use them for drafting, short documents and quick questions.',
    );
  } else if (o.running) {
    st.append(el('span', { className: 'ok', textContent: '● Ollama is running. ' }), `${o.models.length} local model${o.models.length === 1 ? '' : 's'} ready for offline use.`);
  } else {
    const get = el('button', { type: 'button', textContent: 'Get Ollama ↗' });
    get.addEventListener('click', () => window.api.openExternal('https://ollama.com/download'));
    const retry = el('button', { type: 'button', textContent: 'Check again' });
    retry.addEventListener('click', openSettings);
    st.append(
      el('div', {}, el('span', { className: 'warn', textContent: '● Ollama not found. ' }), 'Offline answers run on Ollama, a free app that runs AI models on this computer. Install it once, then download a model below while you are online.'),
      el('div', { className: 'row' }, get, retry),
    );
  }

  const list = $('#localList');
  list.innerHTML = '';
  for (const m of o.models) {
    const rm = el('button', { type: 'button', textContent: 'Remove' });
    rm.addEventListener('click', async () => {
      if (!confirm(`Remove ${m.name} from this ${device ? 'phone' : 'computer'}?`)) return;
      await window.api.ollamaDelete(m.name);
      openSettings();
    });
    list.append(el('div', { className: 'local-item' }, el('span', {}, el('b', { textContent: m.name }), ` · ${fmtSize(m.size)}`), rm));
  }

  const rec = $('#recommended');
  rec.innerHTML = '';
  if (o.running) {
    rec.append(el('div', { className: 'muted small', textContent: device ? 'Models for this phone:' : 'Recommended for documents:' }));
    const have = new Set(o.models.map((m) => m.name));
    for (const r of app.local?.catalog || RECOMMENDED) {
      const btn = el('button', { type: 'button', textContent: have.has(r.name) ? 'Installed' : `Download ${r.size}`, disabled: have.has(r.name) });
      btn.addEventListener('click', () => pull(r.name, btn));
      rec.append(el('div', { className: 'rec-item' }, el('div', { className: 'desc' }, el('b', { textContent: r.name }), el('div', { className: 'muted small', textContent: r.note })), btn));
    }
  }
  $('#customModel').disabled = !o.running;
  $('#pullCustom').disabled = !o.running;
  $('#customModel').placeholder = device ? 'Or paste a model download link (.task file)' : 'Any Ollama model, e.g. qwen3:14b';
  $('#importModel').classList.toggle('hidden', !device);

  const def = $('#localDefault');
  def.innerHTML = '';
  def.append(el('option', { value: '', textContent: o.models.length ? 'First installed model' : 'No local models yet' }));
  for (const m of o.models) def.append(el('option', { value: m.name, textContent: m.name }));
  def.value = app.settings.localModel || '';

  $('#autoOffline').checked = app.settings.autoOffline;
  $('#webSearch').checked = app.settings.webSearch;
  $('#systemPrompt').value = app.settings.systemPrompt || '';
  $('#versionLine').textContent = `Vanguard AI ${app.version}`;
}

$('#importModel').addEventListener('click', async () => {
  try {
    if (await window.api.importLocalModel()) {
      await openSettings();
      renderPicker();
    }
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

$('#pullCustom').addEventListener('click', () => {
  const name = $('#customModel').value.trim();
  if (name) pull(name, $('#pullCustom'));
});

async function pull(name, btn) {
  btn.disabled = true;
  const bar = el('progress', { max: 1, value: 0 });
  btn.replaceWith(bar);
  const off = window.api.onOllamaProgress((p) => {
    if (p.name !== name) return;
    if (p.total) {
      bar.max = p.total;
      bar.value = p.completed || 0;
    }
    bar.title = p.status;
  });
  try {
    await window.api.ollamaPull(name);
    if (!app.settings.localModel) app.settings = await window.api.saveSettings({ localModel: name });
  } catch (err) {
    alert(`Download failed: ${err.message.replace(/^Error invoking remote method '[^']+': /, '')}`);
  } finally {
    off();
    await openSettings();
    renderPicker();
  }
}

boot();
