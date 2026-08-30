// ---------- element refs ----------
const $ = (id) => document.getElementById(id);

const input = $("input");
const actionsBar = $("actions");
const imgWrap = $("imagePreview");
const imgEl = $("img");
const providerEl = $("provider");
const footer = $("footer");
const bar = $("bar");
const content = $("content");

const banner = $("platform-banner");
const bannerText = $("banner-text");
const onboarding = $("onboarding");
const errorBox = $("error");
const errorText = $("error-text");

const viewbar = $("viewbar");
const viewOriginalBtn = $("view-original");
const viewResultBtn = $("view-result");
const runStatus = $("run-status");
const btnCancel = $("btn-cancel");
const btnRetry = $("btn-retry");
const btnCopy = $("btn-copy");
const btnPaste = $("btn-paste");

const settingsDlg = $("settings");
const sHotkey = $("s-hotkey");
const sTargetLang = $("s-targetLang");
const sHideOnBlur = $("s-hideOnBlur");
const sHideDock = $("s-hideDock");
const sDockRow = $("s-dock-row");
const sAutoPaste = $("s-autoPaste");
const sAutoPasteCmd = $("s-autoPasteCmd");
const sAutoPasteStatus = $("s-autoPaste-status");
const sOzone = $("s-ozone");
const sPortal = $("s-portal");
const sOpaque = $("s-opaque");
const sLinux = $("s-linux");
const sLinuxHint = $("s-linux-hint");
const sSecrets = $("s-secrets");
const sDefaultProvider = $("s-defaultProvider");
const provList = $("prov-list");
const actionList = $("action-list");

const palette = $("palette");
const paletteInput = $("palette-input");
const paletteList = $("palette-list");

const actionDlg = $("actionDlg");
const providerDlg = $("providerDlg");

// ---------- state ----------
let cfg = null;
let actions = [];
let appInfo = null;

let currentActionId = null;
let imageData = null;
let providerConfig = null;

let originalText = ""; // text as it was when the run started
let resultText = "";
let view = "original"; // "original" | "result"
let hasResult = false;

let running = false;
let runSeq = 0;
let activeRunId = null;
let lastRun = null; // { actionId, values } — for Retry

// Answers to action follow-up questions, keyed by action id.
const answers = {};

// ---------- layout ----------
input.style.height = "auto";
input.style.minHeight = "220px";

function autoGrowTextarea() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

function visibleHeight(el) {
  return el && !el.hidden ? el.offsetHeight || 0 : 0;
}

function desiredContentHeight() {
  autoGrowTextarea();
  const innerPad = 16;
  const extra = 50;
  return Math.ceil(
    (bar?.offsetHeight || 0) +
      input.scrollHeight +
      visibleHeight(imgWrap) +
      visibleHeight(banner) +
      visibleHeight(onboarding) +
      visibleHeight(errorBox) +
      visibleHeight(viewbar) +
      (footer?.offsetHeight || 0) +
      innerPad +
      extra +
      12
  );
}

let lastSent = 0;
let resizeTimer;
function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const h = desiredContentHeight();
    if (Math.abs(h - lastSent) < 2) return;
    window.winCtl?.resizeTo(h);
    lastSent = h;
  }, 50);
}

input.addEventListener("input", () => {
  // Editing the box edits whichever version is on screen.
  if (view === "result") resultText = input.value;
  else originalText = input.value;
  autoGrowTextarea();
  scheduleResize();
});

const ro = new ResizeObserver(() => scheduleResize());
ro.observe(content);
ro.observe(input);
ro.observe(imgWrap);

// ---------- small UI helpers ----------
function showError(msg) {
  errorText.textContent = msg;
  errorBox.hidden = false;
  scheduleResize();
}
function clearError() {
  errorBox.hidden = true;
  scheduleResize();
}
$("error-dismiss").onclick = clearError;

function flash(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.className =
    "fixed bottom-4 right-4 px-2.5 py-2 bg-black/50 rounded-xl text-xs border border-white/10";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ---------- actions ----------
function actionById(id) {
  return actions.find((a) => a.id === id);
}

function renderActionButtons() {
  actionsBar.innerHTML = "";
  actions.forEach((a, i) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.type = "button";
    b.dataset.actionId = a.id;
    const num = i < 9 ? `<span class="text-xs text-zinc-100 text-opacity-40"> (${i + 1})</span>` : "";
    b.innerHTML = `${escapeHtml(a.label)}${num}`;
    b.title = i < 9 ? `Mod+${i + 1}` : a.label;
    b.onclick = () => runAction(a.id);
    actionsBar.appendChild(b);
  });
  highlight();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function highlight() {
  for (const b of actionsBar.querySelectorAll("button")) {
    b.style.borderColor =
      b.dataset.actionId === currentActionId
        ? "var(--accent)"
        : "rgba(255,255,255,0.1)";
  }
}

// ---------- generic prompt ----------
function askInput({ title, help, placeholder, initial }) {
  const dlg = $("promptDlg");
  const el = $("promptInput");
  const okBtn = $("promptOk");
  const cancelBtn = $("promptCancel");
  $("promptTitle").textContent = title ?? "Input";
  $("promptHelp").textContent = help ?? "";
  el.placeholder = placeholder ?? "";
  el.value = initial ?? "";

  // Resolve from the buttons rather than the dialog's `close` event. The event
  // is the tidier hook, but if it is ever missed the promise never settles and
  // the action hangs forever with no feedback. `close` stays wired as a
  // fallback for closes we did not initiate.
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("close", onClose);
      try {
        if (dlg.open) dlg.close();
      } catch {}
      scheduleResize();
      resolve(value);
    };

    const answer = () => el.value.trim() || placeholder || "";
    const onOk = (e) => {
      e.preventDefault(); // we close it ourselves in finish()
      finish(answer());
    };
    const onCancel = (e) => {
      e?.preventDefault?.();
      finish(null);
    };
    const onClose = () => finish(dlg.returnValue === "ok" ? answer() : null);

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onCancel); // Escape
    dlg.addEventListener("close", onClose);

    dlg.showModal();
    // rAF never fires in a window that is not producing frames, so focus on a
    // plain task instead.
    setTimeout(() => {
      el.focus();
      el.select();
    }, 0);
  });
}

// ---------- running ----------
async function runAction(actionId, { reuseAnswer = false } = {}) {
  const action = actionById(actionId);
  if (!action) return showError(`Unknown action: ${actionId}`);

  currentActionId = actionId;
  highlight();

  // Follow-up question, if this action declares one.
  if (action.input) {
    const seeded =
      answers[actionId] ??
      (action.input.fromConfig ? cfg?.[action.input.fromConfig] : "") ??
      action.input.default ??
      "";
    if (!reuseAnswer || !answers[actionId]) {
      const val = await askInput({
        title: action.input.title || "Input",
        help: action.input.help || "",
        placeholder: seeded || action.input.default || "",
        initial: answers[actionId] || seeded || "",
      });
      if (val === null) return; // user cancelled
      answers[actionId] = val;
    }
  }

  await run(action);
}

async function run(action) {
  // Whatever is on screen right now is the source — so actions chain.
  const source = input.value.trim();
  if (!source && !imageData) {
    return showError("Nothing to send. Paste text or copy an image first.");
  }

  clearError();
  originalText = source;
  lastRun = { actionId: action.id };

  const headers = [];
  if (action.input && answers[action.id]) {
    headers.push(`${action.input.header || "Input"}: ${answers[action.id]}`);
  }
  const composedText = headers.length ? `${headers.join("\n")}\n\n${source}` : source;

  const runId = ++runSeq;
  activeRunId = runId;
  running = true;
  resultText = "";
  hasResult = true;
  setView("result");
  setBusy(true, action.label);

  try {
    const res = await window.api.runLLM({
      runId,
      action: action.id,
      inputText: composedText,
      imageData,
      providerConfig,
    });

    if (runId !== activeRunId) return; // superseded by a newer run

    if (res?.aborted) {
      runStatus.textContent = "Cancelled";
      return;
    }
    if (!res || res.error) throw new Error(res?.error || "Unknown LLM error");

    // Non-streaming providers return the whole thing at the end.
    if (res.text && res.text !== resultText) {
      resultText = res.text;
      if (view === "result") setTextarea(resultText);
    }

    await window.api.writeClipboard(resultText);

    if (cfg?.autoPaste?.enabled) {
      const p = await window.api.pasteBack(resultText);
      runStatus.textContent = p?.ok ? "Pasted" : "Copied to clipboard";
      if (p && !p.ok && p.error) showError(p.error);
    } else {
      runStatus.textContent = "Copied to clipboard";
      flash("Copied to clipboard!");
    }
  } catch (err) {
    if (runId === activeRunId) {
      runStatus.textContent = "Failed";
      showError(err.message);
    }
  } finally {
    if (runId === activeRunId) {
      running = false;
      setBusy(false);
    }
  }
}

// Stream deltas straight into the textarea.
window.api.onDelta(({ runId, delta }) => {
  if (runId !== activeRunId) return; // stale run
  resultText += delta;
  if (view === "result") {
    setTextarea(resultText);
    input.scrollTop = input.scrollHeight;
  }
});

function setTextarea(text) {
  input.value = text;
  autoGrowTextarea();
  scheduleResize();
}

function setBusy(busy, label) {
  btnCancel.hidden = !busy;
  btnRetry.hidden = busy;
  input.readOnly = busy;
  if (busy) runStatus.textContent = `${label ?? "Running"}…`;
  document.body.style.opacity = busy ? 0.85 : 1;
}

function setView(next) {
  view = next;
  viewbar.hidden = !hasResult;
  btnPaste.hidden = !cfg?.autoPaste?.enabled;
  setTextarea(view === "result" ? resultText : originalText);
  const on = "var(--accent)";
  const off = "rgba(255,255,255,0.1)";
  viewOriginalBtn.style.borderColor = view === "original" ? on : off;
  viewResultBtn.style.borderColor = view === "result" ? on : off;
}

viewOriginalBtn.onclick = () => setView("original");
viewResultBtn.onclick = () => setView("result");
btnCancel.onclick = () => {
  window.api.cancelLLM();
  running = false;
  setBusy(false);
  runStatus.textContent = "Cancelled";
};
btnRetry.onclick = () => {
  if (lastRun) runAction(lastRun.actionId, { reuseAnswer: true });
};
btnCopy.onclick = async () => {
  await window.api.writeClipboard(input.value);
  flash("Copied!");
};
btnPaste.onclick = async () => {
  const p = await window.api.pasteBack(input.value);
  if (p && !p.ok && p.error) showError(p.error);
};

// ---------- clipboard payload ----------
function applyPayload(p) {
  if (!p) return;
  // A fresh open starts a fresh document.
  hasResult = false;
  resultText = "";
  view = "original";
  viewbar.hidden = true;
  clearError();

  if (p.text) input.value = p.text;
  originalText = input.value;

  imageData = p.imageData || null;
  if (imageData) {
    imgEl.src = imageData;
    imgWrap.hidden = false;
  } else {
    imgEl.src = "";
    imgWrap.hidden = true;
  }
  autoGrowTextarea();
  requestAnimationFrame(() => scheduleResize());
  input.focus();
  input.select();
}

window.api.onOpened((payload) => {
  applyPayload(payload);
  if (payload?.action) runAction(payload.action);
  else highlight();
});

window.api.onOpenSettings?.(() => openSettings());

// ---------- keyboard ----------
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const dialogOpen = document.querySelector("dialog[open]");

  if (e.key === "Escape") {
    if (dialogOpen) return; // the dialog handles its own Escape
    if (running) {
      btnCancel.onclick();
      return;
    }
    window.api.hideWindow();
    return;
  }

  if (!mod || dialogOpen) return;

  if (e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
    return;
  }

  const byNumber = actions[Number(e.key) - 1];
  if (byNumber) {
    e.preventDefault();
    runAction(byNumber.id);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const a = actionById(currentActionId) || actions[0];
    if (a) runAction(a.id, { reuseAnswer: true });
  }
});

// ---------- command palette ----------
let paletteIndex = 0;
let paletteMatches = [];

function openPalette() {
  paletteInput.value = "";
  renderPalette("");
  palette.showModal();
  requestAnimationFrame(() => paletteInput.focus());
}

function renderPalette(q) {
  const needle = q.trim().toLowerCase();
  paletteMatches = actions.filter(
    (a) =>
      !needle ||
      a.label.toLowerCase().includes(needle) ||
      a.id.toLowerCase().includes(needle)
  );
  paletteIndex = 0;
  paintPalette();
}

function paintPalette() {
  paletteList.innerHTML = "";
  paletteMatches.forEach((a, i) => {
    const row = document.createElement("div");
    row.className =
      "px-3 py-2 rounded-lg text-sm cursor-pointer border " +
      (i === paletteIndex
        ? "border-accent/60 bg-white/10"
        : "border-transparent hover:bg-white/5");
    row.innerHTML = `<div class="font-medium">${escapeHtml(a.label)}</div>
      <div class="text-xs text-zinc-400">${escapeHtml(a.id)}</div>`;
    row.onclick = () => {
      palette.close();
      runAction(a.id);
    };
    paletteList.appendChild(row);
  });
}

paletteInput.addEventListener("input", () => renderPalette(paletteInput.value));
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteIndex = Math.min(paletteIndex + 1, paletteMatches.length - 1);
    paintPalette();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteIndex = Math.max(paletteIndex - 1, 0);
    paintPalette();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const a = paletteMatches[paletteIndex];
    if (a) {
      palette.close();
      runAction(a.id);
    }
  }
});
palette.addEventListener("close", () => setTimeout(scheduleResize, 10));

// ---------- settings ----------
$("btn-settings").onclick = () => openSettings();
$("onboard-open").onclick = () => openSettings();
$("settingsClose")?.addEventListener("click", () => settingsDlg.close());
settingsDlg.addEventListener("close", () => setTimeout(scheduleResize, 10));
$("promptDlg").addEventListener("close", () => setTimeout(scheduleResize, 10));

async function openSettings() {
  cfg = await window.api.getConfig();
  appInfo = await window.api.getInfo();

  sHotkey.value = cfg.hotkey || "";
  sTargetLang.value = cfg.targetLang || "";
  sHideOnBlur.checked = cfg.hideOnBlur !== false;
  sOzone.value = cfg.ozonePlatform || "";
  sPortal.checked = !!cfg.useGlobalShortcutsPortal;
  sOpaque.checked = !!cfg.disableTransparency;
  sHideDock.checked = !!cfg.hideDockIcon;
  sAutoPaste.checked = !!cfg.autoPaste?.enabled;
  sAutoPasteCmd.value = cfg.autoPaste?.command || "";

  sDockRow.hidden = !appInfo.isMac;
  sLinux.hidden = !appInfo.isLinux;
  if (appInfo.isLinux) {
    sLinuxHint.textContent = appInfo.isWayland
      ? "Wayland session detected. Electron's global hotkey is an X11 grab, so it only fires while an X11 window has focus. Bind your compositor to `echo-llm --toggle` for a hotkey that always works."
      : "X11 session detected. Global hotkeys should work normally.";
  }

  const ap = appInfo.autoPaste || {};
  sAutoPasteStatus.textContent = ap.available
    ? `Ready — will use \`${ap.tool}\`.`
    : ap.hint || "No supported paste tool found.";
  sAutoPasteStatus.className = ap.available
    ? "text-xs text-zinc-400"
    : "text-xs text-amber-300";

  sSecrets.textContent = `API keys are stored in: ${appInfo.secrets?.label || "unknown"}.`;
  sSecrets.className = appInfo.secrets?.secure
    ? "text-xs text-zinc-400"
    : "text-xs text-amber-300";

  renderActionList();
  await refreshProvidersUI();
  settingsDlg.showModal();
}

$("saveSettings")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const next = {
    hotkey: sHotkey.value,
    targetLang: sTargetLang.value,
    hideOnBlur: sHideOnBlur.checked,
    hideDockIcon: sHideDock.checked,
    ozonePlatform: sOzone.value,
    useGlobalShortcutsPortal: sPortal.checked,
    disableTransparency: sOpaque.checked,
    autoPaste: {
      enabled: sAutoPaste.checked,
      command: sAutoPasteCmd.value.trim(),
    },
    actions,
  };
  const restartKeys = ["ozonePlatform", "disableTransparency", "hideDockIcon"];
  const needsRestart = restartKeys.some((k) => next[k] !== (cfg?.[k] ?? (k === "ozonePlatform" ? "" : false)));

  const res = await window.api.setConfig(next);
  if (!res?.ok) return showError("Could not save settings");

  cfg = res.config;
  actions = cfg.actions || [];
  renderActionButtons();
  await applyFooterProviderLabel();
  await refreshPlatformBanner();
  setView(view);
  settingsDlg.close();
  flash(needsRestart ? "Saved — restart Echo to apply" : "Settings saved");
});

// ---------- action editor ----------
function renderActionList() {
  actionList.innerHTML = "";
  actions.forEach((a, i) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between border border-white/10 rounded-lg px-3 py-2 bg-white/5 gap-2";

    const meta = document.createElement("div");
    meta.className = "text-sm min-w-0";
    meta.innerHTML = `<div class="font-medium">${escapeHtml(a.label)} ${
      i < 9 ? `<span class="text-xs text-zinc-500">Mod+${i + 1}</span>` : ""
    }</div>
      <div class="text-xs text-zinc-400 truncate">${escapeHtml(a.prompt || "")}</div>`;

    const acts = document.createElement("div");
    acts.className = "flex gap-1 shrink-0";

    const mk = (label, fn, title) => {
      const b = document.createElement("button");
      b.className = "btn py-0.5";
      b.type = "button";
      b.textContent = label;
      if (title) b.title = title;
      b.onclick = (e) => {
        e.preventDefault();
        fn();
      };
      return b;
    };

    acts.append(
      mk("↑", () => moveAction(i, -1), "Move up"),
      mk("↓", () => moveAction(i, 1), "Move down"),
      mk("Edit", () => openActionEditor(a)),
      mk("Delete", () => {
        if (actions.length === 1) return showError("Keep at least one action.");
        if (!confirm(`Delete action "${a.label}"?`)) return;
        actions.splice(i, 1);
        renderActionList();
      })
    );

    row.append(meta, acts);
    actionList.appendChild(row);
  });
}

function moveAction(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= actions.length) return;
  [actions[i], actions[j]] = [actions[j], actions[i]];
  renderActionList();
}

function openActionEditor(a = null) {
  $("a-origId").value = a?.id || "";
  $("a-label").value = a?.label || "";
  $("a-id").value = a?.id || "";
  $("a-prompt").value = a?.prompt || "";
  $("a-hasInput").checked = !!a?.input;
  $("a-inputTitle").value = a?.input?.title || "";
  $("a-inputHelp").value = a?.input?.help || "";
  $("a-inputHeader").value = a?.input?.header || "";
  $("a-input-rows").classList.toggle("hidden", !a?.input);
  actionDlg.showModal();
}

$("a-hasInput").addEventListener("change", (e) => {
  $("a-input-rows").classList.toggle("hidden", !e.target.checked);
});
$("actionCancelBtn").onclick = () => actionDlg.close();
$("btn-add-action").onclick = (e) => {
  e.preventDefault();
  openActionEditor(null);
};
$("btn-reset-actions").onclick = async (e) => {
  e.preventDefault();
  if (!confirm("Replace all actions with the defaults?")) return;
  const res = await window.api.setConfig({ actions: null });
  cfg = res.config;
  actions = cfg.actions || [];
  renderActionList();
  renderActionButtons();
};

$("actionForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const origId = $("a-origId").value;
  const label = $("a-label").value.trim() || "Action";
  const id =
    ($("a-id").value.trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "_")).replace(
      /^_+|_+$/g,
      ""
    ) || "action";
  const prompt = $("a-prompt").value.trim();
  if (!prompt) return showError("An action needs a prompt.");

  if (actions.some((a) => a.id === id && a.id !== origId)) {
    return showError(`An action with id "${id}" already exists.`);
  }

  const next = { id, label, prompt };
  if ($("a-hasInput").checked) {
    next.input = {
      key: id,
      header: $("a-inputHeader").value.trim() || "Input",
      title: $("a-inputTitle").value.trim() || "Input",
      help: $("a-inputHelp").value.trim(),
    };
  }

  const idx = actions.findIndex((a) => a.id === origId);
  if (idx >= 0) actions[idx] = { ...actions[idx], ...next, input: next.input };
  else actions.push(next);

  actionDlg.close();
  renderActionList();
});

// ---------- providers ----------
const pType = $("p-type");
function showProviderRowsForType(type) {
  const isOllama = type === "ollama";
  $("p-row-host").classList.toggle("hidden", !isOllama);
  $("p-row-apiBase").classList.toggle("hidden", isOllama);
  $("p-row-apiKey").classList.toggle("hidden", isOllama);
}
pType.addEventListener("change", () => showProviderRowsForType(pType.value));

async function refreshProvidersUI() {
  const { providers, defaultProviderId } = await window.api.listProviders();

  sDefaultProvider.innerHTML = "";
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.label} (${p.type})`;
    if (p.id === defaultProviderId) opt.selected = true;
    sDefaultProvider.appendChild(opt);
  }

  provList.innerHTML = "";
  for (const p of providers) {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between border border-white/10 rounded-lg px-3 py-2 bg-white/5";

    // Ollama and local gateways legitimately need no key.
    const needsKey = p.type === "openai" || p.type === "gemini";
    const keyBadge = p.hasKey
      ? '<span class="text-emerald-400">key saved</span>'
      : needsKey
      ? '<span class="text-amber-400">no key</span>'
      : '<span class="text-zinc-500">no key needed</span>';

    const meta = document.createElement("div");
    meta.className = "text-sm";
    meta.innerHTML = `<div class="font-medium">${escapeHtml(p.label)}</div>
      <div class="text-xs text-zinc-400">${escapeHtml(p.type)} · ${escapeHtml(
      p.model || ""
    )} · ${escapeHtml(p.type === "ollama" ? p.host || "" : p.apiBase || "")} · ${keyBadge}</div>`;

    const actionsEl = document.createElement("div");
    actionsEl.className = "flex gap-2";

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.onclick = (e) => {
      e.preventDefault();
      openProviderEditor(p);
    };

    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`Delete provider "${p.label}"?`)) return;
      const res = await window.api.deleteProvider(p.id);
      if (!res?.ok) return showError(res.error || "Delete failed");
      await refreshProvidersUI();
      await applyFooterProviderLabel();
    };

    actionsEl.append(editBtn, delBtn);
    row.append(meta, actionsEl);
    provList.appendChild(row);
  }
}

function openProviderEditor(p = null) {
  $("p-id").value = p?.id || "";
  $("p-label").value = p?.label || "";
  pType.value = p?.type || "openai";
  $("p-apiBase").value = p?.apiBase || "";
  $("p-apiKey").value = "";
  $("p-host").value = p?.host || "";
  $("p-model").value = p?.model || "";
  showProviderRowsForType(pType.value);
  providerDlg.showModal();
}

$("providerCancelBtn")?.addEventListener("click", () => providerDlg.close());
$("btn-add-provider")?.addEventListener("click", (e) => {
  e.preventDefault();
  openProviderEditor(null);
});

$("providerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prov = {
    id: $("p-id").value || undefined,
    label: $("p-label").value.trim() || "Provider",
    type: pType.value,
    apiBase: $("p-apiBase").value.trim() || undefined,
    apiKey: $("p-apiKey").value.trim() || undefined,
    host: $("p-host").value.trim() || undefined,
    model: $("p-model").value.trim() || "",
  };
  const res = await window.api.saveProvider(prov);
  if (!res?.ok) return showError(res.error || "Save failed");
  providerDlg.close();
  await refreshProvidersUI();
  await applyFooterProviderLabel();
});

sDefaultProvider?.addEventListener("change", async () => {
  const res = await window.api.setDefaultProvider(sDefaultProvider.value);
  if (!res?.ok) return showError(res.error || "Failed to set default");
  await applyFooterProviderLabel();
});

async function applyFooterProviderLabel() {
  try {
    const { providers, defaultProviderId } = await window.api.listProviders();
    const def = providers.find((p) => p.id === defaultProviderId);
    providerEl.textContent = def
      ? `Provider: ${def.label}${def.model ? ` · ${def.model}` : ""}`
      : "No provider — open Settings";

    onboarding.hidden = !!def;
    providerConfig = {
      providerId: def?.id,
      targetLang: cfg?.targetLang,
    };
    scheduleResize();
  } catch {}
}

// ---------- platform banner ----------
const BANNER_DISMISSED = "echo:bannerDismissed";

async function refreshPlatformBanner() {
  if (!banner) return;
  appInfo = await window.api.getInfo();

  let msg = "";
  if (!appInfo.hotkeyRegistered && appInfo.isWayland) {
    msg =
      "No global hotkey on this Wayland session. Bind your compositor to <code>echo-llm --toggle</code> — e.g. Hyprland: <code>bind = ALT, SPACE, exec, echo-llm --toggle</code>.";
  } else if (!appInfo.hotkeyRegistered) {
    msg =
      "Echo couldn't register a global hotkey — another app probably owns it. Pick a different one in Settings, or launch with <code>echo-llm --toggle</code>.";
  } else if (appInfo.isWayland) {
    msg = `Hotkey <code>${escapeHtml(
      appInfo.hotkey
    )}</code> is registered, but on Wayland it only fires while an X11 window has focus. For a hotkey that always works, bind your compositor to <code>echo-llm --toggle</code>.`;
  }

  if (!msg || localStorage.getItem(BANNER_DISMISSED) === msg) {
    banner.hidden = true;
  } else {
    bannerText.innerHTML = msg;
    banner.hidden = false;
    banner.dataset.msg = msg;
  }
  scheduleResize();
}

$("banner-dismiss")?.addEventListener("click", () => {
  localStorage.setItem(BANNER_DISMISSED, banner.dataset.msg || "1");
  banner.hidden = true;
  scheduleResize();
});

// ---------- boot ----------
(async () => {
  cfg = await window.api.getConfig();
  actions = cfg.actions || [];
  currentActionId = actions[0]?.id || null;
  renderActionButtons();
  await applyFooterProviderLabel();
  await refreshPlatformBanner();
})();
