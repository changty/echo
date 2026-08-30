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
  shell,
  Tray,
} from "electron";
import fs from "fs";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";
import { runLLM } from "./providers/providerManager.js";
import { deleteSecret, getSecret, secretsStatus, setSecret } from "./secrets.js";
import { autoPasteCapability, pasteToFocusedApp } from "./autopaste.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let blurIgnoreUntil = 0;
let win;
let tray;
let CONFIG_PATH;
let activeHotkey = null; // what we actually managed to grab, or null

// ---------- platform ----------
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
// Wayland app_id / X11 WM_CLASS, derived by Electron from the app name and
// lowercased. Window rules on tiling compositors must match this exactly.
const WM_CLASS = "echo";
const IS_WAYLAND =
  IS_LINUX &&
  (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);

// ---------- paths ----------
const appRoot = () => app.getAppPath();
const resolveInApp = (...parts) => join(appRoot(), ...parts);

// ---------- config ----------
function defaultConfig() {
  return {
    hotkey: IS_MAC ? "Alt+Space" : "Ctrl+Space",
    targetLang: "",
    defaultProviderId: "prov-openai",

    // Hide the window when it loses focus. Great on macOS, frequently awful on
    // Linux WMs with focus-follows-mouse, where merely moving the pointer makes
    // the launcher vanish mid-typing.
    hideOnBlur: true,

    // macOS only. Hides the Dock icon so Echo behaves like a menu-bar utility.
    hideDockIcon: false,

    // Opt-in. Writes the result to the clipboard, hides Echo, then synthesises
    // a paste keystroke into whatever app had focus. Needs Accessibility
    // permission on macOS and wtype/ydotool/xdotool on Linux.
    autoPaste: { enabled: false, command: "" },

    actions: defaultActions(),

    // Some Linux compositors render transparent+resizable windows as a black
    // rectangle. Flip this on to get an opaque window instead.
    disableTransparency: false,

    // Linux only. "" = leave Electron alone (runs under XWayland on Wayland
    // sessions). "auto" = let Electron pick native Wayland — sharper on HiDPI
    // and fractional scaling, but global shortcuts must come from the
    // compositor (see `echo-llm --toggle`).
    ozonePlatform: "",

    // Linux only. Opt into Chromium's XDG GlobalShortcuts portal. Requires a
    // portal implementation that provides org.freedesktop.impl.portal.GlobalShortcuts
    // (Hyprland and KDE do) and a recent Electron.
    useGlobalShortcutsPortal: false,

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

// Actions are plain config, so users can add their own without touching code.
// `input` makes the action ask a follow-up question first; the answer is
// prepended to the prompt as "<header>: <answer>" and, when `fromConfig` is
// set, seeded from that config field.
function defaultActions() {
  return [
    {
      id: "ask",
      label: "Ask",
      prompt: "Give a brief answer or explanation to the given input",
    },
    {
      id: "proofread",
      label: "Proofread",
      prompt:
        "You are a meticulous copy editor. Fix grammar, punctuation, clarity, and tone while preserving meaning. Provide only the proofread result. No other explanation.",
    },
    {
      id: "translate_en",
      label: "To English",
      prompt:
        "Translate the user's text to natural, idiomatic English. Provide only the translation, no other explanations.",
    },
    {
      id: "translate_to",
      label: "To…",
      prompt:
        "Translate the user's text into the target language. Provide only the translation without any explanation.",
      input: {
        key: "targetLang",
        header: "Target language",
        title: "Translate to which language?",
        help: "e.g., Finnish",
        fromConfig: "targetLang",
      },
    },
    {
      id: "summarize",
      label: "Summarize",
      prompt:
        "Summarize the user's text concisely. Capture key points and any actionable items.",
    },
    {
      id: "rewrite_style",
      label: "Rewrite",
      prompt:
        "Rewrite the user's text in the requested style. Honor the style faithfully while preserving meaning. USE THE ORIGINAL LANGUAGE!",
      input: {
        key: "style",
        header: "Style",
        title: "Rewrite in which style?",
        help: "e.g., formal, friendly, academic, marketing",
        default: "formal",
      },
    },
  ];
}

let config = defaultConfig();

// Before app.setName("Echo") existed, `npm run dev` derived userData from the
// package name ("echo"). macOS/Windows filesystems are case-insensitive so that
// is the same folder, but on Linux ~/.config/echo and ~/.config/Echo are two
// different places — without this, an existing install looks factory-reset.
function migrateLegacyConfig(userCfg) {
  if (fs.existsSync(userCfg)) return;
  for (const legacyDir of [path.join(app.getPath("appData"), "echo")]) {
    const legacy = path.join(legacyDir, "config.json");
    try {
      if (legacyDir !== path.dirname(userCfg) && fs.existsSync(legacy)) {
        fs.copyFileSync(legacy, userCfg);
        console.log("[config] migrated from", legacy);
        return;
      }
    } catch (e) {
      console.warn("[config] migration failed:", e?.message || e);
    }
  }
}

function loadConfig() {
  const userCfg = path.join(app.getPath("userData"), "config.json");
  CONFIG_PATH = userCfg;
  try {
    fs.mkdirSync(path.dirname(userCfg), { recursive: true });
  } catch {}
  migrateLegacyConfig(userCfg);
  if (fs.existsSync(userCfg)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(userCfg, "utf8"));
      // Merge over defaults so configs written by older versions pick up new
      // keys instead of arriving as undefined.
      config = { ...defaultConfig(), ...parsed };
    } catch (e) {
      console.warn("loadConfig failed, using defaults:", e?.message || e);
    }
  }
  if (!config) config = defaultConfig();
  if (!Array.isArray(config.providers) || !config.providers.length) {
    config.providers = defaultConfig().providers;
  }
  if (!Array.isArray(config.actions) || !config.actions.length) {
    config.actions = defaultActions();
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.warn("saveConfig failed:", e);
  }
}

// ---------- CLI ----------
// Lets the window manager own the hotkey, which is the only reliable way to get
// a global shortcut on Wayland:
//     bind = ALT, SPACE, exec, echo-llm --toggle       (Hyprland)
//     bindsym Mod1+space exec echo-llm --toggle        (sway)
function parseCli(argv) {
  const args = (argv || []).slice(1);
  const has = (f) => args.includes(f);
  const valueOf = (f) => {
    const hit = args.find((a) => a.startsWith(`${f}=`));
    return hit ? hit.slice(f.length + 1) : null;
  };
  return {
    toggle: has("--toggle"),
    show: has("--show"),
    hide: has("--hide"),
    quit: has("--quit"),
    action: valueOf("--action"),
    text: valueOf("--text"),
  };
}

function handleCli(cli) {
  if (cli.quit) {
    app.quit();
    return;
  }
  if (cli.hide) {
    win?.hide();
    return;
  }
  if (cli.action || cli.text) {
    openWindow({ action: cli.action, text: cli.text });
    return;
  }
  if (cli.show) {
    openWindow();
    return;
  }
  if (cli.toggle) {
    toggleWindow();
    return;
  }
  // Bare re-launch: behave like --show, since the user clearly wants the app.
  openWindow();
}

// ---------- early switches (must run before app is ready) ----------
app.setName("Echo");
loadConfig();

if (IS_LINUX) {
  // Electron defaults safeStorage to the "basic" store, which is obfuscation,
  // not encryption. Let Chromium detect gnome-libsecret / kwallet instead so
  // the fallback tier is genuinely encrypted when a keyring exists.
  app.commandLine.appendSwitch("password-store", "detect");

  if (config.ozonePlatform) {
    app.commandLine.appendSwitch("ozone-platform-hint", config.ozonePlatform);
  }
  if (config.useGlobalShortcutsPortal) {
    app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
  }
}
if (IS_WIN) app.setAppUserModelId("com.eduten.echo");

// ---------- single instance ----------
// Without this, launching Echo again spawns a second copy: two trays, two
// windows fighting over the same hotkey. It also gives us the CLI channel.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => handleCli(parseCli(argv)));
  bootstrap();
}

// ---------- window ----------
function createWindow() {
  const transparent = !config.disableTransparency;

  win = new BrowserWindow({
    width: 920,
    height: 320,
    minHeight: 320,
    minWidth: 480,
    resizable: true,
    useContentSize: true,
    frame: false,
    transparent,
    // Only paint a background in the opaque fallback — a backgroundColor would
    // sit in front of macOS vibrancy.
    ...(transparent ? {} : { backgroundColor: "#18181b" }),
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    icon: trayIconPath("app"),
    // macOS-only chrome. Passing these on Linux/Windows is harmless but noisy,
    // so keep them off other platforms.
    ...(IS_MAC ? { vibrancy: "under-window", visualEffectState: "active" } : {}),
    webPreferences: {
      preload: resolveInApp("preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile(resolveInApp("src", "renderer.html"));

  // ECHO_DEBUG=1 surfaces renderer console output in the terminal. A frameless,
  // hide-on-blur window makes DevTools awkward, so this is the quick way in.
  if (process.env.ECHO_DEBUG) {
    win.webContents.on("console-message", (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`);
    });
    win.webContents.on("render-process-gone", (_e, d) =>
      console.error("[renderer gone]", d)
    );
  }

  // Never let the WM destroy the window — a Linux user hitting "close" (or
  // Hyprland's killactive) would otherwise leave the app running with no way
  // back in. Hide instead.
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("blur", () => {
    if (config.hideOnBlur === false) return;
    if (win?.webContents.isDevToolsOpened()) return;
    if (Date.now() < blurIgnoreUntil) return; // ignore transient blur
    win?.hide();
  });

  return win;
}

function ensureWindow() {
  if (!win || win.isDestroyed()) createWindow();
  return win;
}

// Wayland refuses programmatic window placement, so setPosition is a no-op
// there and the compositor decides. Under X11/XWayland/macOS/Windows this puts
// the launcher on whichever screen the pointer is on, a third of the way down.
function positionOnActiveDisplay() {
  if (!win || win.isDestroyed()) return;
  try {
    const cursor = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
    const [w, h] = win.getSize();
    win.setPosition(
      Math.round(wa.x + (wa.width - w) / 2),
      Math.round(wa.y + Math.max(0, (wa.height - h) / 3))
    );
  } catch {
    try {
      win.center();
    } catch {}
  }
}

// ---------- hotkey ----------
function isValidAccel(acc) {
  return typeof acc === "string" && acc.trim() !== "";
}

function showOnActiveSpace() {
  if (!win || win.isDestroyed()) return;

  blurIgnoreUntil = Date.now() + 800;

  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}
  try {
    win.setAlwaysOnTop(true, "screen-saver");
  } catch {}

  win.show();
  win.focus();
  // Some Linux WMs map the window without giving it keyboard focus. A second,
  // slightly delayed focus call wins that race often enough to matter.
  if (IS_LINUX) setTimeout(() => !win?.isDestroyed() && win.focus(), 60);
}

function openWindow({ action, text } = {}) {
  ensureWindow();
  positionOnActiveDisplay();
  showOnActiveSpace();
  const payload = readClipboardPayload();
  if (text) payload.text = text;
  if (action) payload.action = action;
  const send = () => win.webContents.send("app:opened", payload);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

function toggleWindow() {
  ensureWindow();
  if (win.isVisible() && win.isFocused()) win.hide();
  else openWindow();
}

function registerHotkey() {
  activeHotkey = null;
  try {
    globalShortcut.unregisterAll();

    let acc = isValidAccel(config.hotkey) ? config.hotkey : defaultConfig().hotkey;

    if (globalShortcut.register(acc, toggleWindow)) {
      activeHotkey = acc;
      return;
    }

    console.warn("Failed to register hotkey:", acc);
    for (const f of ["Ctrl+Space", "Ctrl+Shift+Space", "CommandOrControl+Shift+Space"]) {
      if (f !== acc && globalShortcut.register(f, toggleWindow)) {
        activeHotkey = f;
        break;
      }
    }

    // Deliberately do NOT persist the fallback. Registration failure is the
    // norm on Wayland, where the compositor owns the hotkey; overwriting the
    // user's chosen accelerator there would silently churn their config.
    // activeHotkey reflects this session; config.hotkey stays their choice.
  } catch (e) {
    console.error("registerHotkey error", e);
  }

  // On Wayland this is expected, not exceptional: Electron's globalShortcut is
  // an X11 key grab, so under XWayland it only fires while an X11 window has
  // focus — the "works sometimes" behaviour. Don't nag with a modal dialog;
  // the renderer shows an inline banner explaining the `--toggle` fix instead.
  if (!activeHotkey && !IS_WAYLAND) {
    dialog.showMessageBox({
      type: "warning",
      message: `Couldn't register a global hotkey. Open Echo from the tray icon and pick another in Settings.`,
    });
  }
}

// ---------- tray ----------
function trayIconPath(kind) {
  // macOS wants a template image (black + alpha, auto-inverted by the OS).
  // Linux panels and the Windows tray need a real, coloured icon — a template
  // image there renders as an invisible black smudge on a dark panel.
  const file =
    kind === "app" ? "icon.png" : IS_MAC ? "trayTemplate.png" : "tray.png";
  const candidates = [
    resolveInApp("assets", file),
    join(process.resourcesPath || "", "assets", file),
    join(__dirname, "assets", file),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function createTray() {
  try {
    const p = trayIconPath("tray");
    if (!p) {
      console.warn("createTray: no tray icon found in assets/");
      return null;
    }
    const img = nativeImage.createFromPath(p);
    if (!img || img.isEmpty()) {
      console.warn("createTray: icon failed to decode:", p);
      return null;
    }
    if (IS_MAC) img.setTemplateImage(true);

    const t = new Tray(img);
    t.setToolTip("Echo");

    const menu = Menu.buildFromTemplate([
      { label: activeHotkey ? `Open  (${activeHotkey})` : "Open", click: () => openWindow() },
      { type: "separator" },
      { label: "Proofread clipboard", click: () => openWindow({ action: "proofread" }) },
      { label: "Translate clipboard → English", click: () => openWindow({ action: "translate_en" }) },
      { label: "Summarize clipboard", click: () => openWindow({ action: "summarize" }) },
      { type: "separator" },
      { label: "Settings…", click: () => { openWindow(); win.webContents.send("app:openSettings"); } },
      { label: "Show config folder", click: () => shell.showItemInFolder(CONFIG_PATH) },
      { type: "separator" },
      { label: "Quit Echo", click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    t.setContextMenu(menu);

    // Only Windows gives us a usable left-click alongside a context menu:
    // macOS routes both buttons to the menu, and Linux AppIndicator emits no
    // click event at all.
    if (IS_WIN) t.on("click", () => toggleWindow());

    return t;
  } catch (e) {
    console.warn("createTray failed:", e);
    return null;
  }
}

// ---------- clipboard payload ----------
function readClipboardPayload() {
  let text = "";
  let imageData = null;
  try {
    text = clipboard.readText().trim();
  } catch {}
  try {
    const img = clipboard.readImage();
    if (!img.isEmpty()) {
      imageData = `data:image/png;base64,${Buffer.from(img.toPNG()).toString("base64")}`;
    }
  } catch (e) {
    // Wayland clipboard reads can transiently fail if the owning app exited.
    console.warn("clipboard image read failed:", e?.message || e);
  }
  return { text, imageData };
}

// ---------- app lifecycle ----------
function bootstrap() {
  app.whenReady().then(() => {
    createWindow();
    registerHotkey();
    tray = createTray();

    // Opt-in: a launcher arguably doesn't belong in the Dock, but flipping this
    // by default would change macOS behaviour that already works well.
    if (IS_MAC && config.hideDockIcon) app.dock?.hide();

    handleCli(parseCli(process.argv));
  });

  app.on("activate", () => openWindow());

  // A launcher has no business quitting when its window hides.
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    app.isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}

// ---------- IPC ----------
ipcMain.on("hide-window", () => {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
});

ipcMain.handle("app:info", async () => ({
  platform: process.platform,
  isWayland: IS_WAYLAND,
  isLinux: IS_LINUX,
  isMac: IS_MAC,
  hotkey: activeHotkey,
  configuredHotkey: config.hotkey,
  hotkeyRegistered: !!activeHotkey,
  configPath: CONFIG_PATH,
  wmClass: WM_CLASS,
  version: app.getVersion(),
  secrets: await secretsStatus(),
  autoPaste: { ...(await autoPasteCapability()), enabled: !!config.autoPaste?.enabled },
}));

ipcMain.handle("api:saveKey", async (_evt, account, apiKey) => setSecret(account, apiKey));
ipcMain.handle("api:clearKey", async (_evt, account) => deleteSecret(account));

ipcMain.handle("clipboard:read", () => readClipboardPayload());
ipcMain.handle("clipboard:write", (_e, text) => {
  clipboard.writeText(text || "");
  return true;
});

ipcMain.handle("config:get", () => ({ ...config }));
ipcMain.handle("config:set", (_e, next) => {
  const hotkeyChanged = next && "hotkey" in next && next.hotkey !== config.hotkey;
  config = { ...config, ...next };
  // Settings sends actions:null to mean "restore the built-in set".
  if (!Array.isArray(config.actions) || !config.actions.length) {
    config.actions = defaultActions();
  }
  saveConfig();
  if (hotkeyChanged) {
    registerHotkey();
    // Rebuild the tray so its "Open (accelerator)" label stays truthful.
    try {
      tray?.destroy();
    } catch {}
    tray = createTray();
  }
  return { ok: true, config, hotkey: activeHotkey };
});

// providers CRUD
// Ollama and OpenAI-compatible gateways routinely need no key, so don't touch
// the keychain for them — every read is a possible macOS authorization prompt.
const NEEDS_KEY = new Set(["openai", "gemini"]);

ipcMain.handle("providers:list", async () => ({
  providers: await Promise.all(
    config.providers.map(async (p) => ({
      ...p,
      hasKey: NEEDS_KEY.has(p.type) ? !!(await getSecret(p.id)) : false,
    }))
  ),
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

  // Any non-empty key is worth storing. The old `length > 10` check silently
  // dropped short keys used by local/self-hosted gateways.
  if (typeof prov.apiKey === "string" && prov.apiKey.trim()) {
    const res = await setSecret(id, prov.apiKey.trim());
    if (!res.ok) return { ok: false, error: res.error || "Could not store API key" };
  }

  const idx = config.providers.findIndex((p) => p.id === id);
  if (idx >= 0) config.providers[idx] = { ...config.providers[idx], ...normalized };
  else config.providers.push(normalized);

  if (!config.defaultProviderId) config.defaultProviderId = id;
  saveConfig();
  return { ok: true, provider: normalized };
});

ipcMain.handle("providers:delete", async (_e, id) => {
  const idx = config.providers.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "Not found" };
  config.providers.splice(idx, 1);
  // Don't orphan the stored key when its provider goes away.
  await deleteSecret(id);
  if (config.defaultProviderId === id) {
    config.defaultProviderId = config.providers[0]?.id || null;
  }
  saveConfig();
  return { ok: true };
});

ipcMain.handle("window:resizeTo", (_e, { height, width, margin = 80 }) => {
  if (!win || win.isDestroyed()) return { ok: false, error: "no window" };

  const bounds = win.getBounds();
  const [, ch] = win.getContentSize();
  const chrome = bounds.height - ch; // titlebar etc. (frameless → ~0)
  const minH = 320;

  // Wayland hands back meaningless window coordinates, so the "keep the bottom
  // edge on screen" math cannot be trusted there — fall back to a work-area cap.
  let disp;
  try {
    disp = IS_WAYLAND
      ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      : screen.getDisplayMatching(bounds);
  } catch {
    disp = screen.getPrimaryDisplay();
  }
  const wa = disp.workArea;

  const maxByWork = Math.floor(wa.height * 0.95);
  const maxByBottom = IS_WAYLAND
    ? maxByWork
    : wa.y + wa.height - bounds.y - chrome - margin;
  const hardMax = Math.max(minH, Math.min(maxByBottom, maxByWork));

  const targetH = Math.max(minH, Math.min(Math.floor(height || ch), hardMax));
  const targetW = Math.floor(width || bounds.width);

  win.setContentSize(targetW, targetH);
  return { ok: true, size: { width: targetW, height: targetH } };
});

// Only one generation runs at a time; starting a new one supersedes the old.
let currentRun = null;

ipcMain.on("llm:cancel", () => {
  try {
    currentRun?.controller.abort();
  } catch {}
});

ipcMain.handle("llm:run", async (_e, payload) => {
  const { runId, action, inputText, imageData, providerConfig } = payload || {};
  try {
    const providerId = providerConfig?.providerId || config.defaultProviderId;
    const providerSpec =
      config.providers.find((p) => p.id === providerId) || config.providers[0];
    if (!providerSpec)
      return { error: "No provider configured. Open Settings to add one." };

    const system = getSystemPrompt(action, { hasImage: !!imageData });
    const apiKey = (await getSecret(providerSpec.id)) || "";

    try {
      currentRun?.controller.abort();
    } catch {}
    const controller = new AbortController();
    currentRun = { runId, controller };

    // Stream tokens straight to the renderer as they arrive. Deltas from a
    // superseded run are dropped by runId on the renderer side.
    const onDelta = (delta) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("llm:delta", { runId, delta });
      }
    };

    const res = await runLLM({
      providerSpec,
      apiKey,
      system,
      inputText,
      imageData,
      onDelta,
      signal: controller.signal,
    });

    if (currentRun?.runId === runId) currentRun = null;
    return { ...res, runId };
  } catch (e) {
    if (currentRun?.runId === runId) currentRun = null;
    return { error: e?.message || String(e), runId };
  }
});

// Auto-paste: put the text on the clipboard, get out of the way, then send the
// paste keystroke to whichever window regained focus.
ipcMain.handle("paste:run", async (_e, text) => {
  if (!config.autoPaste?.enabled) return { ok: false, error: "Auto-paste is disabled" };
  clipboard.writeText(text || "");
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  return await pasteToFocusedApp({ custom: config.autoPaste?.command });
});

function getSystemPrompt(actionId, { hasImage } = { hasImage: false }) {
  const list = config.actions?.length ? config.actions : defaultActions();
  const action =
    list.find((a) => a.id === actionId) ||
    list.find((a) => a.id === "proofread") ||
    list[0];
  const visionHint = hasImage
    ? " If an image is provided, first transcribe the text in the image accurately, then perform the task. Return ONLY the final result."
    : "";
  return `${action?.prompt || ""}${visionHint}`;
}
