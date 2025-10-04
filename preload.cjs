const { contextBridge, ipcRenderer } = require("electron");

console.log("[preload] loaded");

contextBridge.exposeInMainWorld("api", {
  onOpened: (cb) => ipcRenderer.on("app:opened", (_e, payload) => cb(payload)),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  runLLM: (payload) => ipcRenderer.invoke("llm:run", payload),

  // config
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (next) => ipcRenderer.invoke("config:set", next),

  // providers CRUD
  listProviders: () => ipcRenderer.invoke("providers:list"),
  saveProvider: (prov) => ipcRenderer.invoke("providers:save", prov),
  deleteProvider: (id) => ipcRenderer.invoke("providers:delete", id),
  setDefaultProvider: (id) => ipcRenderer.invoke("providers:setDefault", id),

  // tiny ping for sanity
  ping: () => ipcRenderer.invoke("ping"),
});
