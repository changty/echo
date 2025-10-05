import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import fs from "fs";
import keytar from "keytar";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";
import { runLLM } from "./providers/providerManager.js";

const SERVICE = "com.eduten.echo";
const OPENAI_API_KEY = "OPENAI_API_KEY";
const GEMINI_API_KEY = "GEMINI_API_KEY";
// dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let win;
let tray;
let CONFIG_PATH;

// ---------- paths ----------
const appRoot = () => app.getAppPath();
const resolveInApp = (...parts) => join(appRoot(), ...parts);

// ---------- config ----------
function defaultConfig() {
  return {
    hotkey: "Ctrl+Space",
    targetLang: "",
    defaultProviderId: "prov-openai",
    providers: [
      {
        id: "prov-openai",
        label: "OpenAI (prod)",
        type: "openai",
        apiBase: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      },
      {
        id: "prov-compat",
        label: "OpenAI-Compatible (local)",
        type: "openaiCompatible",
        apiBase: "http://localhost:11434/v1",
        model: "gpt-4o-mini",
      },
      {
        id: "prov-ollama",
        label: "Ollama (localhost)",
        type: "ollama",
        host: "http://localhost:11434",
        model: "llama3.1:8b",
      },
      {
        id: "prov-gemini",
        label: "Gemini (Google AI Studio)",
        type: "gemini",
        apiBase: "https://generativelanguage.googleapis.com",
        model: "gemini-2.5-flash",
      },
    ],
  };
}

let config = defaultConfig();

function loadConfig() {
  const userCfg = path.join(app.getPath("userData"), "config.json");
  CONFIG_PATH = userCfg;
  try {
    fs.mkdirSync(path.dirname(userCfg), { recursive: true });
  } catch {}
  if (fs.existsSync(userCfg)) {
    try {
      config = JSON.parse(fs.readFileSync(userCfg, "utf8"));
    } catch {}
  }
  if (!config) config = defaultConfig();
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.warn("saveConfig failed:", e);
  }
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 320,
    minHeight: 320,
    resizable: true,
    useContentSize: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    vibrancy: "under-window",
    visualEffectState: "active",
    contextIsolation: true,
    webPreferences: {
      preload: resolveInApp("preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const htmlPath = resolveInApp("src", "renderer.html");
  win.loadFile(htmlPath);

  // Debug visibility & logs
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[did-fail-load]", code, desc, url);
  });
  win.webContents.on("did-finish-load", () => {
    console.log("[did-finish-load] OK:", htmlPath);
    win.show();
  });
  win.webContents.on("console-message", (_e, level, message) => {
    console.log("[renderer]", level, message);
  });

  win.on("blur", () => {
    if (win.webContents.isDevToolsOpened()) return;
    win.hide();
  });
}

// ---------- hotkey ----------
function isValidAccel(acc) {
  return typeof acc === "string" && acc.trim() !== "";
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

function registerHotkey() {
  try {
    globalShortcut.unregisterAll();

    let acc = config.hotkey;
    if (!isValidAccel(acc)) acc = "Ctrl+Space";

    const ok = globalShortcut.register(acc, toggleWindow);
    if (!ok) {
      console.warn("Failed to register hotkey:", acc);
      const fallbacks = [
        "Ctrl+Space",
        "Ctrl+Shift+Space",
        "CommandOrControl+Shift+Space",
      ];
      let used = null;
      for (const f of fallbacks) {
        if (globalShortcut.register(f, toggleWindow)) {
          used = f;
          break;
        }
      }
      if (used) {
        dialog.showMessageBox({
          type: "warning",
          message: `Couldn’t register "${acc}". Using "${used}" instead. You can change it in Settings.`,
        });
        config.hotkey = used;
        saveConfig();
      } else {
        dialog.showMessageBox({
          type: "warning",
          message: `Couldn’t register "${acc}". Open settings to pick another.`,
        });
        toggleWindow(); // ensure UI is reachable
      }
    }
  } catch (e) {
    console.error("registerHotkey error", e);
    toggleWindow();
  }
}

// ---------- tray ----------
function createTray() {
  try {
    const p = resolveInApp("src", "icons", "trayTemplate.png");
    let img = nativeImage.createFromPath(p);
    if (!img || img.isEmpty()) return null;
    img.setTemplateImage?.(true);
    const t = new Tray(img);
    t.setToolTip("Echo");
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open", click: () => toggleWindow() },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ])
    );
    return t;
  } catch (e) {
    console.warn("createTray failed:", e);
    return null;
  }
}

// ---------- clipboard payload ----------
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

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  registerHotkey();
  tray = createTray();

  // Devtools toggle
  globalShortcut.register("CommandOrControl+Alt+I", () => {
    if (win) win.webContents.toggleDevTools();
  });
});

app.on("activate", () => {
  if (win) {
    win.show();
    win.focus();
    win.webContents.send("app:opened", readClipboardPayload());
  }
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// ---------- IPC ----------

ipcMain.handle("api:saveKey", async (_evt, apiKey, account) => {
  await keytar.setPassword(SERVICE, account, apiKey);
  return { ok: true };
});

ipcMain.handle("api:clearKey", async (account) => {
  await keytar.deletePassword(SERVICE, account);
  return { ok: true };
});

async function getApiKey(account) {
  if (!account || account.length === 0) {
    return "";
  }
  return keytar.getPassword(SERVICE, account);
}

ipcMain.handle("clipboard:read", () => readClipboardPayload());
ipcMain.handle("clipboard:write", (_e, text) => {
  clipboard.writeText(text || "");
  return true;
});

ipcMain.handle("config:get", () => ({ ...config }));
ipcMain.handle("config:set", (_e, next) => {
  config = { ...config, ...next }; // hotkey/targetLang etc.
  saveConfig();
  registerHotkey();
  return { ok: true, config };
});

// providers CRUD
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
ipcMain.handle("providers:save", async (_e, prov) => {
  const id = prov.id || "prov-" + Date.now().toString(36);
  const normalized = {
    id,
    label: prov.label || "Provider",
    type: prov.type,
    apiBase: prov.apiBase,
    host: prov.host,
    model: prov.model,
  };

  if (prov.apiKey && prov.apiKey.length > 10) {
    const account = id;
    await keytar.setPassword(SERVICE, account, prov.apiKey);
    console.log("Saving apikey", SERVICE, account, prov.apiKey);
    delete prov.apiKey;
  }

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

ipcMain.handle("window:resizeTo", (_e, { height, width, margin = 80 }) => {
  if (!win) return { ok: false, error: "no window" };

  const bounds = win.getBounds(); // window (incl. chrome)
  const [cw, ch] = win.getContentSize(); // content size now
  const chrome = bounds.height - ch; // titlebar etc. (frameless → ~0)
  const disp = screen.getDisplayMatching(bounds);
  const wa = disp.workArea; // excludes Dock/Menu Bar
  const bottom = wa.y + wa.height;
  const minH = 320;

  // Max content height so bottom stays on-screen
  const maxByBottom = bottom - bounds.y - chrome - margin;
  // Also apply a global cap (e.g. 95% of work area)
  const maxByWork = Math.floor(wa.height * 0.95);
  const hardMax = Math.max(minH, Math.min(maxByBottom, maxByWork));

  const reqH = Math.floor(height || ch);
  const targetH = Math.max(minH, Math.min(reqH, hardMax));
  const targetW = Math.floor(width || bounds.width);

  // useContentSize must be true on the BrowserWindow
  win.setContentSize(targetW, targetH);
  return { ok: true, size: { width: targetW, height: targetH } };
});

ipcMain.handle("llm:run", async (_e, payload) => {
  const { action, inputText, imageData, providerConfig } = payload;
  const providerId = providerConfig?.providerId || config.defaultProviderId;
  const providerSpec =
    config.providers.find((p) => p.id === providerId) || config.providers[0];
  const system = getSystemPrompt(action, { hasImage: !!imageData });
  const apiKey = (await getApiKey(providerId)) || "";

  return await runLLM({ providerSpec, apiKey, system, inputText, imageData });
});

function getSystemPrompt(action, { hasImage } = { hasImage: false }) {
  const visionHint = hasImage
    ? " If an image is provided, first transcribe the text in the image accurately, then perform the task. Return ONLY the final result."
    : "";
  const base = {
    ask: `Give a brief answer or explanation to the given input${visionHint}`,
    proofread: `You are a meticulous copy editor. Fix grammar, punctuation, clarity, and tone while preserving meaning. Provide only the proofread result. No other explanation.${visionHint}`,
    translate_en: `Translate the user's text to natural, idiomatic English. Provide only the translation, no other explanations.${visionHint}`,
    translate_to: `Translate the user's text into the target language. Provide only the translation without any explanation.${visionHint}`,
    summarize: `Summarize the user's text concisely. Capture key points and any actionable items.${visionHint}`,
    rewrite_style: `Rewrite the user's text in the requested style. Honor the style faithfully while preserving meaning. USE THE ORIGINAL LANGUAGE!${visionHint}`,
  };
  return base[action] || base.proofread;
}
