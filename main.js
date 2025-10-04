import dotenv from "dotenv";
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import fs from "fs";
import path from "path";
import url from "url";
ipcMain.handle("ping", () => "pong from main");

import { runLLM } from "./providers/providerManager.js";

dotenv.config();
const isDev = !app.isPackaged;
let win;
let tray;

const CONFIG_PATH = path.join(process.cwd(), "config.json");
function defaultConfig() {
  return {
    hotkey: "Alt+Space",
    targetLang: "",
    defaultProviderId: "prov-openai",
    providers: [
      {
        id: "prov-openai",
        label: "OpenAI (prod)",
        type: "openai",
        apiBase: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4o-mini",
      },
      {
        id: "prov-compat",
        label: "OpenAI-Compatible (local)",
        type: "openaiCompatible",
        apiBase: "http://localhost:11434/v1",
        apiKeyEnv: "OPENAI_COMPAT_KEY",
        model: "gpt-4o-mini",
      },
      {
        id: "prov-ollama",
        label: "Ollama (localhost)",
        type: "ollama",
        host: "http://localhost:11434",
        model: "llama3.1:8b",
      },
    ],
  };
}

let config = defaultConfig();
if (fs.existsSync(CONFIG_PATH)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch {}
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(process.cwd(), "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const indexURL = isDev
    ? url.format({
        protocol: "file",
        slashes: true,
        pathname: path.join(process.cwd(), "src/renderer.html"),
      })
    : url.format({
        protocol: "file",
        slashes: true,
        pathname: path.join(process.resourcesPath, "src/renderer.html"),
      });

  win.loadURL(indexURL);

  win.webContents.on("did-finish-load", () => {
    if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
  });

  win.on("blur", () => {
    // Keep window visible if you're debugging in a detached DevTools window
    if (win.webContents.isDevToolsOpened()) return;
    win.hide();
  });
}

function registerHotkey() {
  try {
    globalShortcut.unregisterAll();
    globalShortcut.register(config.hotkey, () => toggleWindow());
  } catch (e) {
    console.error("Failed to register hotkey", e);
  }
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.center();
    win.show();
    win.webContents.send("app:opened", readClipboardPayload());
  }
}

function readClipboardPayload() {
  const text = clipboard.readText().trim();
  const img = clipboard.readImage();
  const hasImage = !img.isEmpty();
  let imageData = null;
  if (hasImage) {
    const png = img.toPNG();
    const base64 = Buffer.from(png).toString("base64");
    imageData = `data:image/png;base64,${base64}`;
  }
  return { text, imageData };
}

app.whenReady().then(() => {
  createWindow();
  registerHotkey();
  globalShortcut.register("CommandOrControl+Alt+I", () => {
    if (win) win.webContents.toggleDevTools();
  });

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Echo");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => toggleWindow() },
      { label: "Quit", click: () => app.quit() },
    ])
  );
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle("clipboard:read", () => readClipboardPayload());
ipcMain.handle("clipboard:write", (_e, text) => {
  clipboard.writeText(text || "");
  return true;
});

ipcMain.handle("config:get", () => ({ ...config }));
ipcMain.handle("config:set", (_e, next) => {
  // Merge & persist
  config = { ...config, ...next };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch {}
  registerHotkey();
  return { ok: true, config };
});

// ----- IPC: providers CRUD -----
ipcMain.handle("providers:list", () => ({
  providers: config.providers,
  defaultProviderId: config.defaultProviderId,
}));

ipcMain.handle("providers:setDefault", (_e, id) => {
  if (!config.providers.find((p) => p.id === id))
    return { ok: false, error: "Provider not found" };
  config.defaultProviderId = id;
  saveConfig();
  return { ok: true };
});

ipcMain.handle("providers:save", (_e, prov) => {
  const id = prov.id || "prov-" + Date.now().toString(36);
  const normalized = {
    id,
    label: prov.label || "Provider",
    type: prov.type, // 'openai' | 'openaiCompatible' | 'ollama'
    apiBase: prov.apiBase,
    apiKeyEnv: prov.apiKeyEnv,
    host: prov.host,
    model: prov.model,
  };
  const idx = config.providers.findIndex((p) => p.id === id);
  if (idx >= 0)
    config.providers[idx] = { ...config.providers[idx], ...normalized };
  else config.providers.push(normalized);
  saveConfig();
  return { ok: true, provider: normalized };
});

ipcMain.handle("providers:delete", (_e, id) => {
  const idx = config.providers.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "Not found" };
  config.providers.splice(idx, 1);
  if (config.defaultProviderId === id) {
    config.defaultProviderId = config.providers[0]?.id || null;
  }
  saveConfig();
  return { ok: true };
});

ipcMain.handle("llm:run", async (_e, payload) => {
  const { action, inputText, imageData, providerConfig } = payload;
  const providerId = providerConfig?.providerId || config.defaultProviderId;
  const providerSpec =
    config.providers.find((p) => p.id === providerId) || config.providers[0];
  const system = getSystemPrompt(action, { hasImage: !!imageData });
  const response = await runLLM({ providerSpec, system, inputText, imageData });
  return response;
});

function getSystemPrompt(action, { hasImage } = { hasImage: false }) {
  const visionHint = hasImage
    ? " If an image is provided, first transcribe the text in the image accurately, then perform the task. Return ONLY the final result."
    : "";
  const base = {
    proofread: `You are a meticulous copy editor. Fix grammar, punctuation, clarity, and tone while preserving meaning.${visionHint}`,
    translate_en: `Translate the user's text to natural, idiomatic English. Provide only the translation, no other explanations.${visionHint}`,
    translate_to: `Translate the user's text into the target language. Provide only the translation without any explanation.${visionHint}`,
    summarize: `Summarize the user's text concisely. Capture key points and any actionable items.${visionHint}`,
    rewrite_style: `Rewrite the user's text in the requested style. Honor the style faithfully while preserving meaning. USE THE ORIGINAL LANGUAGE!${visionHint}`,
  };
  return base[action] || base.proofread;
}
