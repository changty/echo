// Renderer for the standalone Settings window.
//
// This used to be a <dialog> inside the launcher window. A dialog cannot be
// taller than the window hosting it, and the launcher is deliberately ~360px,
// so the panel was clipped and its Close/Save buttons sat off-screen. Settings
// is now its own BrowserWindow, sized independently of the launcher.

const $ = (id) => document.getElementById(id);

// ---------- element refs ----------
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

const errorBox = $("settings-error");
const errorText = $("settings-error-text");

const actionDlg = $("actionDlg");
const providerDlg = $("providerDlg");

// ---------- state ----------
let cfg = null;
let actions = [];
let appInfo = null;

// ---------- small helpers ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showError(msg) {
  errorText.textContent = msg;
  errorBox.hidden = false;
}
function clearError() {
  errorBox.hidden = true;
}
$("settings-error-dismiss").onclick = clearError;

function flash(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.className =
    "fixed bottom-4 right-4 px-2.5 py-2 bg-black/70 rounded-xl text-xs border border-white/10";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function closeWindow() {
  window.api.closeSettings();
}

// ---------- load ----------
async function load() {
  cfg = await window.api.getConfig();
  appInfo = await window.api.getInfo();
  actions = cfg.actions || [];

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
}

// ---------- save ----------
$("saveSettings").addEventListener("click", async (e) => {
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
  const needsRestart = restartKeys.some(
    (k) => next[k] !== (cfg?.[k] ?? (k === "ozonePlatform" ? "" : false))
  );

  const res = await window.api.setConfig(next);
  if (!res?.ok) return showError("Could not save settings");

  cfg = res.config;
  actions = cfg.actions || [];
  if (needsRestart) {
    flash("Saved — restart Echo to apply");
    setTimeout(closeWindow, 900);
  } else {
    closeWindow();
  }
});

$("settingsClose").addEventListener("click", (e) => {
  e.preventDefault();
  closeWindow();
});

// Frameless window, so Escape is the only "close" affordance besides the button.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.querySelector("dialog[open]")) return; // the dialog handles its own Escape
  closeWindow();
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
});

sDefaultProvider?.addEventListener("change", async () => {
  const res = await window.api.setDefaultProvider(sDefaultProvider.value);
  if (!res?.ok) return showError(res.error || "Failed to set default");
});

// Reload whenever the window is shown again, so it never displays stale config.
window.api.onSettingsShown?.(() => load());

load();
