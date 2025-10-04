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

  console.log("payload", payload);

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
  document.body.style.opacity = b ? 0.7 : 1;
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
  const prov = cfg.provider || "openai";
  sProvider.value = prov;
  sModel.value =
    (prov === "openai"
      ? cfg.openai?.model
      : prov === "openaiCompatible"
      ? cfg.openaiCompatible?.model
      : cfg.ollama?.model) || "";
  sBase.value =
    (prov === "openai"
      ? cfg.openai?.apiBase
      : prov === "openaiCompatible"
      ? cfg.openaiCompatible?.apiBase
      : cfg.ollama?.host) || "";
  sTargetLang.value = cfg.targetLang || "";
  settingsDlg.showModal();
}

saveBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const prov = sProvider.value;
  const next = {
    provider: prov,
    hotkey: sHotkey.value,
    targetLang: sTargetLang.value,
  };
  if (prov === "openai")
    next.openai = {
      ...(await window.api.getConfig()).openai,
      apiBase: sBase.value,
      model: sModel.value,
    };
  if (prov === "openaiCompatible")
    next.openaiCompatible = {
      ...(await window.api.getConfig()).openaiCompatible,
      apiBase: sBase.value,
      model: sModel.value,
    };
  if (prov === "ollama")
    next.ollama = {
      ...(await window.api.getConfig()).ollama,
      host: sBase.value,
      model: sModel.value,
    };
  const res = await window.api.setConfig(next);
  if (res?.ok) {
    providerEl.textContent = `Provider: ${prov}`;
    settingsDlg.close();
    flash("Settings saved");
  }
});

// Load provider label from config on first load
(async () => {
  try {
    const cfg = await window.api.getConfig();
    providerConfig = { provider: cfg.provider, targetLang: cfg.targetLang };
    providerEl.textContent = `Provider: ${cfg.provider}`;
  } catch {
    console.log("Error loading provider");
  }
})();
