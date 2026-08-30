// Loads the real renderer against mocked IPC and asserts the UI wiring.
import fs from "fs";
import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const __dirname = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const ok = (n, c, extra = "") => out.push(`${c ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);

const ACTIONS = [
  { id: "ask", label: "Ask", prompt: "p1" },
  { id: "proofread", label: "Proofread", prompt: "p2" },
  { id: "translate_en", label: "To English", prompt: "p3" },
  { id: "translate_to", label: "To…", prompt: "p4", input: { key: "targetLang", header: "Target language", title: "Which language?", fromConfig: "targetLang" } },
  { id: "summarize", label: "Summarize", prompt: "p5" },
  { id: "rewrite_style", label: "Rewrite", prompt: "p6", input: { key: "style", header: "Style", title: "Which style?", default: "formal" } },
];
let CFG = { hotkey: "Alt+Space", targetLang: "Finnish", hideOnBlur: true, autoPaste: { enabled: false, command: "" }, actions: ACTIONS, defaultProviderId: "p1" };

let lastRun = null;
ipcMain.handle("app:info", () => ({ platform: "linux", isWayland: true, isLinux: true, isMac: false, hotkey: "Alt+Space", hotkeyRegistered: true, wmClass: "echo", secrets: { label: "OS keychain", secure: true }, autoPaste: { available: true, tool: "wtype", enabled: false } }));
ipcMain.handle("config:get", () => ({ ...CFG }));
ipcMain.handle("config:set", (_e, n) => { CFG = { ...CFG, ...n }; return { ok: true, config: CFG }; });
ipcMain.handle("clipboard:read", () => ({ text: "", imageData: null }));
ipcMain.handle("clipboard:write", () => true);
ipcMain.handle("paste:run", () => ({ ok: true, tool: "wtype" }));
ipcMain.handle("providers:list", () => ({ providers: [{ id: "p1", label: "Ollama", type: "ollama", model: "llama3", host: "http://x", hasKey: false }], defaultProviderId: "p1" }));
ipcMain.handle("providers:save", () => ({ ok: true }));
ipcMain.handle("providers:delete", () => ({ ok: true }));
ipcMain.handle("providers:setDefault", () => ({ ok: true }));
ipcMain.handle("window:resizeTo", () => ({ ok: true }));
ipcMain.handle("window:modal", () => ({ ok: true }));
ipcMain.on("hide-window", () => {});
ipcMain.on("llm:cancel", () => {});
ipcMain.handle("llm:run", async (_e, p) => {
  lastRun = p;
  for (const d of ["Hel", "lo ", "world"]) {
    win.webContents.send("llm:delta", { runId: p.runId, delta: d });
    await new Promise((r) => setTimeout(r, 5));
  }
  return { text: "Hello world", runId: p.runId };
});

let win;
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true } });
  const errs = [];
  win.webContents.on("console-message", (_e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });
  await win.loadFile(join(__dirname, "src", "renderer.html"));
  await win.webContents.executeJavaScript(`window.addEventListener('unhandledrejection', e => console.error('DBG UNHANDLED ' + (e.reason && e.reason.message || e.reason)));`);
  await new Promise((r) => setTimeout(r, 400));
  const js = (code) => win.webContents.executeJavaScript(code);

  try {
    ok("action buttons rendered from config", (await js(`document.querySelectorAll('#actions button').length`)) === 6);
    ok("buttons show hotkey numbers", (await js(`document.querySelector('#actions button').innerText.includes('(1)')`)));
    ok("provider label in footer", (await js(`document.getElementById('provider').textContent`)).includes("Ollama"));
    ok("onboarding hidden when provider exists", (await js(`document.getElementById('onboarding').hidden`)) === true);
    ok("wayland banner shown", (await js(`!document.getElementById('platform-banner').hidden`)));

    // --- streaming run through a no-input action
    await js(`document.getElementById('input').value='hello'; window.__t=1;`);
    await js(`document.querySelector('[data-action-id="proofread"]').click()`);
    await new Promise((r) => setTimeout(r, 400));
    ok("streamed text landed in textarea", (await js(`document.getElementById('input').value`)) === "Hello world");
    ok("viewbar visible after run", (await js(`!document.getElementById('viewbar').hidden`)));
    ok("original preserved, not destroyed", await js(`document.getElementById('view-original').click(); document.getElementById('input').value === 'hello'`));
    ok("result restored on toggle", await js(`document.getElementById('view-result').click(); document.getElementById('input').value === 'Hello world'`));

    ok("main received correct action id", lastRun?.action === "proofread", JSON.stringify(lastRun?.action));

    // --- palette
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true}))`);
    await new Promise((r) => setTimeout(r, 200));
    ok("palette opens on Mod+K", await js(`document.getElementById('palette').open === true`));
    await js(`const p=document.getElementById('palette-input'); p.value='sum'; p.dispatchEvent(new Event('input'));`);
    ok("palette filters", (await js(`document.querySelectorAll('#palette-list > div').length`)) === 1);
    await js(`document.getElementById('palette').close()`);

    // --- error UI replaces alert()
    await js(`document.getElementById('input').value=''; document.getElementById('view-original').click();`);
    await js(`document.getElementById('input').value='';`);
    await js(`document.querySelector('[data-action-id="ask"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    ok("inline error instead of alert()", await js(`!document.getElementById('error').hidden && document.getElementById('error-text').textContent.includes('Nothing to send')`));

    // --- action with follow-up input opens the prompt dialog
    await js(`document.getElementById('input').value='moi'; document.querySelector('[data-action-id="translate_to"]').click()`);
    await new Promise((r) => setTimeout(r, 250));
    ok("input-action opens prompt dialog", await js(`document.getElementById('promptDlg').open === true`));
    ok("prompt seeded from config.targetLang", (await js(`document.getElementById('promptInput').value`)) === "Finnish");
    await js(`document.getElementById('promptOk').click()`);
    await new Promise((r) => setTimeout(r, 400));
    ok("header sent to model", lastRun?.inputText?.startsWith("Target language: Finnish"), JSON.stringify(lastRun?.inputText));

    ok("no renderer errors", errs.length === 0, errs.join(" | ").slice(0, 200));
  } catch (e) {
    ok("harness completed", false, e?.stack || String(e));
  }

  fs.writeFileSync(1, out.join("\n") + "\n");
  app.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
});
