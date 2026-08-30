const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Main → renderer
  onOpened: (cb) => ipcRenderer.on("app:opened", (_e, payload) => cb(payload)),
  onOpenSettings: (cb) => ipcRenderer.on("app:openSettings", () => cb()),

  // Environment / diagnostics (platform, Wayland, hotkey state, key storage)
  getInfo: () => ipcRenderer.invoke("app:info"),

  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  runLLM: (payload) => ipcRenderer.invoke("llm:run", payload),
  cancelLLM: () => ipcRenderer.send("llm:cancel"),
  onDelta: (cb) => ipcRenderer.on("llm:delta", (_e, d) => cb(d)),

  // Opt-in auto-paste: hides Echo and replays a paste keystroke.
  pasteBack: (text) => ipcRenderer.invoke("paste:run", text),
  hideWindow: () => ipcRenderer.send("hide-window"),

  // config
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (next) => ipcRenderer.invoke("config:set", next),

  // API keys — both args were previously mismatched with the main-process
  // handler, so clearKey deleted a key named after the IPC event object.
  saveKey: (account, key) => ipcRenderer.invoke("api:saveKey", account, key),
  clearKey: (account) => ipcRenderer.invoke("api:clearKey", account),

  // providers CRUD
  listProviders: () => ipcRenderer.invoke("providers:list"),
  saveProvider: (prov) => ipcRenderer.invoke("providers:save", prov),
  deleteProvider: (id) => ipcRenderer.invoke("providers:delete", id),
  setDefaultProvider: (id) => ipcRenderer.invoke("providers:setDefault", id),
});

contextBridge.exposeInMainWorld("winCtl", {
  resizeTo: (height, width) =>
    ipcRenderer.invoke("window:resizeTo", { height, width }),
});
