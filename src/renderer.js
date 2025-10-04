const input = document.getElementById("input");
const btnProof = document.getElementById("act-proof");
const btnEn = document.getElementById("act-en");
const btnTo = document.getElementById("act-to");
const btnSum = document.getElementById("act-sum");
const btnRewrite = document.getElementById("act-rewrite");
const btnSettings = document.getElementById("btn-settings");
const imgWrap = document.getElementById("imagePreview");
const imgEl = document.getElementById("img");
const providerEl = document.getElementById("provider");
const settingsDlg = document.getElementById("settings");
const sHotkey = document.getElementById("s-hotkey");
const sProvider = document.getElementById("s-provider");
const sModel = document.getElementById("s-model");
const sBase = document.getElementById("s-base");
const sTargetLang = document.getElementById("s-targetLang");
const saveBtn = document.getElementById("saveSettings");

const sDefaultProvider = document.getElementById("s-defaultProvider");
const provList = document.getElementById("prov-list");
const btnAddProvider = document.getElementById("btn-add-provider");

const providerDlg = document.getElementById("providerDlg");
const providerForm = document.getElementById("providerForm");
const pId = document.getElementById("p-id");
const pModel = document.getElementById("p-model");
const pLabel = document.getElementById("p-label");
const pType = document.getElementById("p-type");
const pApiBase = document.getElementById("p-apiBase");
const pApiKeyEnv = document.getElementById("p-apiKeyEnv");
const pHost = document.getElementById("p-host");
const pRowApiBase = document.getElementById("p-row-apiBase");
const pRowApiKeyEnv = document.getElementById("p-row-apiKeyEnv");
const pRowHost = document.getElementById("p-row-host");
const providerSaveBtn = document.getElementById("providerSaveBtn");
document.getElementById("providerCancelBtn")?.addEventListener("click", () => {
  providerDlg.close();
});

document.getElementById("settingsClose")?.addEventListener("click", () => {
  settingsDlg.close();
});

let currentAction = "proofread";
let imageData = null;
let providerConfig = null;
let rewriteStyle = null;

function setAction(a) {
  currentAction = a;
  highlight();
}
function highlight() {
  for (const b of [btnProof, btnEn, btnTo, btnSum, btnRewrite])
    b.style.borderColor = "rgba(255,255,255,0.1)";
  const m = {
    proofread: btnProof,
    translate_en: btnEn,
    translate_to: btnTo,
    summarize: btnSum,
    rewrite_style: btnRewrite,
  }[currentAction];
  m.style.borderColor = "var(--accent)";
}

function applyPayload(p) {
  if (p.text) input.value = p.text;
  imageData = p.imageData || null;
  if (imageData) {
    imgEl.src = imageData;
    imgWrap.hidden = false;
  } else {
    imgWrap.hidden = true;
  }
  input.focus();
  input.select();
}

window.api.onOpened((payload) => {
  applyPayload(payload);
});

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape") window.close();
  if (e.altKey && e.key === "1") {
    setAction("proofread");
  }
  if (e.altKey && e.key === "2") {
    setAction("translate_en");
  }
  if (e.altKey && e.key === "3") {
    setAction("translate_to");
    askLanguage();
  }
  if (e.altKey && e.key === "4") {
    setAction("summarize");
    run();
  }
  if (e.altKey && e.key === "5") {
    setAction("rewrite_style");
    askStyle();
  }
  if (mod && e.key === "Enter") {
    run();
  }
});

btnProof.onclick = () => setAction("proofread");
btnEn.onclick = () => setAction("translate_en");
btnTo.onclick = () => {
  setAction("translate_to");
  askLanguage();
};
btnSum.onclick = () => {
  setAction("summarize");
  run();
};
btnRewrite.onclick = () => {
  setAction("rewrite_style");
  askStyle();
};
btnSettings.onclick = async () => openSettings();

async function askInput({ title, help, placeholder, initial = "" }) {
  return new Promise((resolve) => {
    promptTitle.textContent = title;
    promptHelp.textContent = help || "";
    promptInput.placeholder = placeholder || "";
    promptInput.value = initial || "";
    const onClose = () => {
      cleanup();
      resolve(
        promptDlg.returnValue === "default" ? promptInput.value.trim() : null
      );
    };
    const onKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        promptOk.click();
      }
    };
    function cleanup() {
      promptDlg.removeEventListener("close", onClose);
      promptInput.removeEventListener("keydown", onKey);
    }
    promptDlg.addEventListener("close", onClose, { once: true });
    promptInput.addEventListener("keydown", onKey);
    promptDlg.showModal();
    promptInput.focus();
    promptInput.select();
  });
}

async function askLanguage() {
  const defLang = sTargetLang?.value || "";
  const lang = await askInput({
    title: "Translate to which language?",
    help: "e.g., Finnish",
    placeholder: providerConfig.targetLang || "Mongolian",
    initial: defLang,
  });
  if (lang) {
    providerConfig = { ...(providerConfig || {}), targetLang: lang };
    await run();
  } else {
    // Default language
    await run();
  }
}

async function askStyle() {
  const style = await askInput({
    title: "Rewrite in which style?",
    help: "e.g., formal, friendly, academic, marketing",
    placeholder: "formal",
  });
  if (style) {
    rewriteStyle = style;
    await run();
  } else {
    rewriteStyle = "formal";
    await run();
  }
}

async function run() {
  const text = input.value.trim();
  if (!text && !imageData) {
    alert("Nothing to send. Paste text or copy an image first.");
    return;
  }

  // --- ensure target language for translate_to ---
  let targetLang = providerConfig?.targetLang;
  if (currentAction === "translate_to") {
    // optional: read a default from settings UI if you have one
    const defaultFromSettings =
      typeof sTargetLang !== "undefined" && sTargetLang?.value?.trim();
    if (!targetLang && defaultFromSettings) {
      targetLang = defaultFromSettings;
      providerConfig = { ...(providerConfig || {}), targetLang };
    }
    // if still missing, ask the user once (use your modal prompt if you have one)
    if (!targetLang) {
      // If you implemented askLanguage() already, reuse it:
      if (typeof askLanguage === "function") {
        await askLanguage();
        targetLang = providerConfig?.targetLang;
        if (!targetLang) return; // user cancelled
      } else {
        alert("Please set a target language first.");
        return;
      }
    }
  }

  // --- compose input with headers for the model ---
  const headers = [];
  if (currentAction === "rewrite_style" && rewriteStyle) {
    headers.push(`Style: ${rewriteStyle}`);
  }
  if (currentAction === "translate_to" && targetLang) {
    headers.push(`Target language: ${targetLang}`);
  }

  const composedText = headers.length
    ? `${headers.join("\n")}\n\n${text}`
    : text;

  const payload = {
    action: currentAction,
    inputText: composedText,
    imageData,
    providerConfig,
  };

  setBusy(true);
  try {
    const result = await window.api.runLLM(payload);
    if (!result || result.error) {
      throw new Error(result?.error || "Unknown LLM error");
    }
    await window.api.writeClipboard(result.text);
    input.value = result.text;
    flash("Copied to clipboard!");
  } catch (err) {
    console.error(err);
    alert("Error: " + err.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(b) {
  document.body.style.opacity = b ? 0.6 : 1;
}
function flash(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position = "fixed";
  el.style.bottom = "16px";
  el.style.right = "16px";
  el.style.padding = "8px 10px";
  el.style.background = "rgba(0,0,0,0.5)";
  el.style.borderRadius = "10px";
  el.style.fontSize = "12px";
  el.style.border = "1px solid rgba(255,255,255,0.12)";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// Settings
async function openSettings() {
  const cfg = await window.api.getConfig();
  sHotkey.value = cfg.hotkey || "";
  sTargetLang.value = cfg.targetLang || "";
  await refreshProvidersUI();
  settingsDlg.showModal();
}

saveBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const next = { hotkey: sHotkey.value, targetLang: sTargetLang.value };
  const res = await window.api.setConfig(next);
  if (res?.ok) {
    await applyFooterProviderLabel();
    settingsDlg.close();
    flash("Settings saved");
  }
});

function showProviderRowsForType(type) {
  const isOllama = type === "ollama";
  pRowHost.classList.toggle("hidden", !isOllama);
  pRowApiBase.classList.toggle("hidden", isOllama);
  pRowApiKeyEnv.classList.toggle("hidden", isOllama);
}

pType.addEventListener("change", () => showProviderRowsForType(pType.value));

async function refreshProvidersUI() {
  const { providers, defaultProviderId } = await window.api.listProviders();

  // Default provider dropdown
  sDefaultProvider.innerHTML = "";
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.label} (${p.type})`;
    if (p.id === defaultProviderId) opt.selected = true;
    sDefaultProvider.appendChild(opt);
  }

  // Provider list
  provList.innerHTML = "";
  for (const p of providers) {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between border border-white/10 rounded-lg px-3 py-2 bg-white/5";

    const meta = document.createElement("div");
    meta.className = "text-sm";
    meta.innerHTML = `<div class="font-medium">${p.label}</div>
      <div class="text-xs text-zinc-400">${p.type} · ${p.model || ""} · ${
      p.type === "ollama" ? p.host : p.apiBase
    }</div>`;
    const actions = document.createElement("div");
    actions.className = "flex gap-2";

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
      if (!res?.ok) return alert(res.error || "Delete failed");
      await refreshProvidersUI();
      await applyFooterProviderLabel();
    };

    actions.append(editBtn, delBtn);
    row.append(meta, actions);
    provList.appendChild(row);
  }
}

function openProviderEditor(p = null) {
  console.log("open: ", p);
  pId.value = p?.id || "";
  pLabel.value = p?.label || "";
  pType.value = p?.type || "openai";
  pApiBase.value = p?.apiBase || "";
  pApiKeyEnv.value = p?.apiKeyEnv || "";
  pHost.value = p?.host || "";
  pModel.value = p?.model || "";
  showProviderRowsForType(pType.value);
  providerDlg.showModal();
}

providerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prov = {
    id: pId.value || undefined,
    label: (pLabel.value || "").trim() || "Provider",
    type: pType.value,
    apiBase: (pApiBase.value || "").trim() || undefined,
    apiKeyEnv: (pApiKeyEnv.value || "").trim() || undefined,
    host: (pHost.value || "").trim() || undefined,
    model: (pModel.value || "").trim() || "",
  };
  const res = await window.api.saveProvider(prov);
  if (!res?.ok) return alert(res.error || "Save failed");
  providerDlg.close();
  await refreshProvidersUI();
  await applyFooterProviderLabel();
});

providerSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  const prov = {
    id: pId.value || undefined,
    label: pLabel.value.trim() || "Provider",
    type: pType.value,
    apiBase: pApiBase.value.trim() || undefined,
    apiKeyEnv: pApiKeyEnv.value.trim() || undefined,
    host: pHost.value.trim() || undefined,
    model: pModel.value.trim() || "",
  };
  const res = await window.api.saveProvider(prov);
  if (!res?.ok) return alert(res.error || "Save failed");
  providerDlg.close();
  await refreshProvidersUI();
  await applyFooterProviderLabel();
});

btnAddProvider?.addEventListener("click", (e) => {
  e.preventDefault();
  openProviderEditor(null);
});

sDefaultProvider?.addEventListener("change", async () => {
  const id = sDefaultProvider.value;
  const res = await window.api.setDefaultProvider(id);
  if (!res?.ok) return alert(res.error || "Failed to set default");
  await applyFooterProviderLabel();
});

// Load provider label from config on first load
async function applyFooterProviderLabel() {
  try {
    const { providers, defaultProviderId } = await window.api.listProviders();
    const def = providers.find((p) => p.id === defaultProviderId);
    providerEl.textContent = def ? `Provider: ${def.label}` : "";

    providerConfig = {
      providerId: def?.id,
      targetLang: (await window.api.getConfig()).targetLang,
    };
  } catch {}
}

// call once on boot
(async () => {
  await applyFooterProviderLabel();
})();
