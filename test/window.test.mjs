// Window-level regressions:
//  - the launcher sizes itself exactly, so Linux never draws a document scrollbar
//  - Settings is a separate window, so Close/Save are always reachable
//  - reopening the launcher starts a fresh document from the clipboard
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import { dirname, join as pjoin } from "path";
import { fileURLToPath } from "url";
const ROOT = pjoin(dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const ok = (n, c, extra = "") => out.push(`${c ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);

const ACTIONS = [{ id: "ask", label: "Ask", prompt: "p1" }, { id: "proofread", label: "Proofread", prompt: "p2" }];
let CFG = { hotkey: "Alt+Space", targetLang: "Finnish", hideOnBlur: true, autoPaste: { enabled: false, command: "" }, actions: ACTIONS, defaultProviderId: "p1" };
ipcMain.handle("app:info", () => ({ platform: "linux", isWayland: true, isLinux: true, isMac: false, hotkey: "Alt+Space", configuredHotkey: "Alt+Space", hotkeyRegistered: true, secrets: { label: "OS keychain", secure: true }, autoPaste: { available: true, tool: "wtype", enabled: false } }));
ipcMain.handle("config:get", () => ({ ...CFG }));
ipcMain.handle("config:set", (_e, n) => { CFG = { ...CFG, ...n }; if (!CFG.actions?.length) CFG.actions = ACTIONS; win.webContents.send("config:changed", { ...CFG }); return { ok: true, config: CFG }; });
ipcMain.handle("clipboard:read", () => ({ text: "", imageData: null }));
ipcMain.handle("clipboard:write", () => true);
ipcMain.handle("providers:list", () => ({ providers: [{ id: "p1", label: "Gemini", type: "gemini", model: "gemini-2.5-flash", hasKey: true }], defaultProviderId: "p1" }));
ipcMain.handle("providers:save", () => ({ ok: true }));
ipcMain.handle("providers:delete", () => ({ ok: true }));
ipcMain.handle("providers:setDefault", () => ({ ok: true }));
ipcMain.on("hide-window", () => {});
ipcMain.on("llm:cancel", () => {});
ipcMain.handle("llm:run", async (_e, p) => {
  const t = "GENERATED RESULT TEXT";
  win.webContents.send("llm:delta", { runId: p.runId, delta: t });
  return { text: t, runId: p.runId };
});
let win, sWin;
ipcMain.handle("window:resizeTo", (_e, { height, width }) => {
  const [cw, ch] = win.getContentSize();
  const wa = screen.getPrimaryDisplay().workArea;
  win.setContentSize(Math.floor(width || cw), Math.max(320, Math.min(Math.floor(height || ch), Math.floor(wa.height * 0.95))));
  return { ok: true };
});
ipcMain.handle("settings:open", () => { sWin.show(); sWin.focus(); sWin.webContents.send("settings:shown"); return { ok: true }; });
ipcMain.on("settings:close", () => sWin.hide());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsw = (s) => win.webContents.executeJavaScript(s);
const jss = (s) => sWin.webContents.executeJavaScript(s);

app.whenReady().then(async () => {
  const pref = { preload: join(ROOT, "preload.cjs"), contextIsolation: true };
  win = new BrowserWindow({ show: true, width: 920, height: 320, useContentSize: true, frame: false, webPreferences: pref });
  await win.loadFile(join(ROOT, "src", "renderer.html"));
  sWin = new BrowserWindow({ show: false, width: 900, height: 860, useContentSize: true, frame: false, webPreferences: pref });
  await sWin.loadFile(join(ROOT, "src", "settings.html"));
  await sleep(900);

  // ---- BUG 1: no scrollbar anywhere ----
  win.webContents.send("app:opened", { text: "short text", imageData: null });
  await sleep(500);
  let m = await jsw(`(() => { const c = document.getElementById('content'), d = document.documentElement;
    return { overflow: c.scrollHeight - c.clientHeight, doc: d.scrollHeight - d.clientHeight, h: window.innerHeight }; })()`);
  ok("launcher: #content does not overflow (idle)", m.overflow <= 0, JSON.stringify(m));
  ok("launcher: document does not scroll (idle)", m.doc <= 0);

  // Moderate text: the window can still grow, so nothing may scroll.
  await jsw(`document.getElementById('input').value = ${JSON.stringify("line\n".repeat(12))};
             document.getElementById('input').dispatchEvent(new Event('input'));`);
  await sleep(800);
  m = await jsw(`(() => { const c = document.getElementById('content'), d = document.documentElement;
    return { overflow: c.scrollHeight - c.clientHeight, doc: d.scrollHeight - d.clientHeight, h: window.innerHeight }; })()`);
  ok("launcher: no overflow with growing text", m.overflow <= 0, JSON.stringify(m));
  ok("launcher: document still does not scroll", m.doc <= 0);

  // Huge text: the window hits the work-area cap, so #content -- and only
  // #content -- takes over the scrolling. The document must never scroll.
  await jsw(`document.getElementById('input').value = ${JSON.stringify("line\n".repeat(80))};
             document.getElementById('input').dispatchEvent(new Event('input'));`);
  await sleep(900);
  m = await jsw(`(() => { const c = document.getElementById('content'), d = document.documentElement;
    return { overflow: c.scrollHeight - c.clientHeight, doc: d.scrollHeight - d.clientHeight, h: window.innerHeight,
             cap: Math.floor(screen.availHeight * 0.95) }; })()`);
  ok("launcher: capped window scrolls #content, not the document", m.doc <= 0 && m.overflow > 0, JSON.stringify(m));

  // ---- BUG 3: reopening replaces the result ----
  win.webContents.send("app:opened", { text: "first job", imageData: null });
  await sleep(400);
  await jsw(`document.querySelectorAll('#actions button')[0].click()`);
  await sleep(700);
  let afterRun = await jsw(`document.getElementById('input').value`);
  ok("a run produces a result", afterRun.includes("GENERATED RESULT"), JSON.stringify(afterRun));

  // reopen with a NEW clipboard
  win.webContents.send("app:opened", { text: "second job", imageData: null });
  await sleep(400);
  let st = await jsw(`({ v: document.getElementById('input').value, vb: document.getElementById('viewbar').hidden })`);
  ok("reopen with new clipboard replaces the result", st.v === "second job" && st.vb === true, JSON.stringify(st));

  // reopen with an EMPTY clipboard — the reported regression
  await jsw(`document.querySelectorAll('#actions button')[0].click()`);
  await sleep(700);
  win.webContents.send("app:opened", { text: "", imageData: null });
  await sleep(400);
  st = await jsw(`({ v: document.getElementById('input').value, vb: document.getElementById('viewbar').hidden })`);
  ok("reopen with empty clipboard clears the stale result", st.v === "" && st.vb === true, JSON.stringify(st));

  // ---- BUG 2: settings is its own window, fully reachable ----
  sWin.show(); sWin.webContents.send("settings:shown");
  await sleep(700);
  const s = await jss(`(() => {
    const g = (id) => document.getElementById(id);
    const r = (id) => { const b = g(id).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const body = g('settings-body');
    return {
      winH: window.innerHeight, winW: window.innerWidth,
      docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      close: r('settingsClose'), save: r('saveSettings'),
      bodyScrollable: body.scrollHeight > body.clientHeight,
      hotkeyVal: g('s-hotkey').value,
      actionRows: g('action-list').children.length,
      provRows: g('prov-list').children.length,
    };
  })()`);
  ok("settings: Close button on-screen", s.close.bottom <= s.winH && s.close.top >= 0, JSON.stringify(s.close) + " winH=" + s.winH);
  ok("settings: Save button on-screen", s.save.bottom <= s.winH && s.save.top >= 0, JSON.stringify(s.save));
  ok("settings: window itself does not scroll", s.docScroll <= 0);
  ok("settings: form loaded from config", s.hotkeyVal === "Alt+Space" && s.actionRows === 2 && s.provRows === 1, JSON.stringify({ h: s.hotkeyVal, a: s.actionRows, p: s.provRows }));

  // Save round-trips into the launcher via the broadcast.
  await jss(`document.getElementById('s-targetLang').value = 'Swedish';
             document.getElementById('saveSettings').click();`);
  await sleep(700);
  ok("settings: Save persisted", CFG.targetLang === "Swedish", CFG.targetLang);
  ok("settings: window closed itself after save", !sWin.isVisible());

  console.log(out.join("\n"));
  if (out.some((l) => l.startsWith("FAIL"))) process.exitCode = 1;
  app.exit(0);
});
