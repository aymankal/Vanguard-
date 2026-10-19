const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, data) => fn(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('app:state'),
  online: () => ipcRenderer.invoke('app:online'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setKey: (provider, key) => ipcRenderer.invoke('keys:set', provider, key),
  refreshModels: (provider) => ipcRenderer.invoke('models:refresh', provider),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  extractFiles: (files) => ipcRenderer.invoke('files:extract', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  exportDocx: (markdown, title) => ipcRenderer.invoke('export:docx', markdown, title),
  exportMd: (markdown, title) => ipcRenderer.invoke('export:md', markdown, title),
  getChats: () => ipcRenderer.invoke('chats:get'),
  saveChats: (chats) => ipcRenderer.invoke('chats:save', chats),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  ollamaPull: (name) => ipcRenderer.invoke('ollama:pull', name),
  ollamaDelete: (name) => ipcRenderer.invoke('ollama:delete', name),
  onOllamaProgress: on('ollama:progress'),
  send: (payload) => ipcRenderer.invoke('chat:send', payload),
  stop: (requestId) => ipcRenderer.invoke('chat:stop', requestId),
  onChatEvent: on('chat:event'),
});
