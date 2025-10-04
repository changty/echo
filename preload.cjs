const { contextBridge, ipcRenderer } = require("electron");

console.log("[preload] loaded");

contextBridge.exposeInMainWorld("api", {
  onOpened: (cb) => ipcRenderer.on("app:opened", (_e, payload) => cb(payload)),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  runLLM: (payload) => ipcRenderer.invoke("llm:run", payload),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (next) => ipcRenderer.invoke("config:set", next),
  // tiny ping for sanity
  ping: () => ipcRenderer.invoke("ping"),
});
