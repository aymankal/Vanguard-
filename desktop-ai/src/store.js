// Local storage in the app's data folder. API keys are encrypted with the operating system's
// keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux) and never leave this machine
// except to the provider they belong to.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const dir = () => app.getPath('userData');
const file = (name) => path.join(dir(), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file(name));
}

const DEFAULT_SETTINGS = {
  model: { provider: 'anthropic', id: 'claude-opus-5-5' },
  localModel: '',
  autoOffline: true,
  webSearch: true,
  systemPrompt: '',
  models: {},
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
}

function readKeys() {
  const raw = readJson('keys.json', {});
  const out = {};
  for (const [provider, enc] of Object.entries(raw)) {
    try {
      out[provider] = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(enc, 'base64'))
        : Buffer.from(enc, 'base64').toString('utf8');
    } catch {
      // Unreadable on this machine (copied profile); the user re-enters it.
    }
  }
  return out;
}

function setKey(provider, key) {
  const raw = readJson('keys.json', {});
  if (!key) delete raw[provider];
  else {
    raw[provider] = (safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(key)
      : Buffer.from(key, 'utf8')).toString('base64');
  }
  writeJson('keys.json', raw);
}

const getChats = () => readJson('chats.json', []);
const saveChats = (chats) => writeJson('chats.json', chats);

module.exports = { getSettings, saveSettings, readKeys, setKey, getChats, saveChats };
