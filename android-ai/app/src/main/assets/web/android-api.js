// window.api for the Android app: the same calls desktop-ai/preload.js exposes, answered by
// Bridge.java through the VAIBridge interface. Each call returns a promise.
(() => {
  const pending = new Map();
  const listeners = {};
  let next = 0;

  window.__vai = {
    resolve(id, ok, payload) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(payload === undefined ? undefined : JSON.parse(payload));
      else p.reject(new Error(payload));
    },
    emit(channel, json) {
      const data = JSON.parse(json);
      for (const fn of listeners[channel] || []) fn(data);
    },
  };

  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = String(++next);
    pending.set(id, { resolve, reject });
    window.VAIBridge.call(id, method, JSON.stringify(args));
  });
  const on = (channel) => (fn) => {
    (listeners[channel] ||= []).push(fn);
    return () => { listeners[channel] = listeners[channel].filter((f) => f !== fn); };
  };

  window.api = {
    state: () => call('state'),
    online: () => call('online'),
    saveSettings: (patch) => call('saveSettings', patch),
    setKey: (provider, key) => call('setKey', provider, key),
    refreshModels: (provider) => call('refreshModels', provider),
    openExternal: (url) => call('openExternal', url),
    pickFiles: () => call('pickFiles'),
    extractFiles: () => Promise.resolve([]),
    exportDocx: (markdown, title) => call('exportDocx', markdown, title || ''),
    exportMd: (markdown, title) => call('exportMd', markdown, title || ''),
    getChats: () => call('getChats'),
    saveChats: (chats) => call('saveChats', chats),
    ollamaStatus: () => call('ollamaStatus'),
    ollamaPull: (name) => call('ollamaPull', name),
    ollamaDelete: (name) => call('ollamaDelete', name),
    importLocalModel: () => call('importLocalModel'),
    onOllamaProgress: on('ollama:progress'),
    send: (payload) => call('send', payload),
    stop: (requestId) => call('stop', requestId),
    onChatEvent: on('chat:event'),
    copy: (text) => call('copy', text),
  };
})();
