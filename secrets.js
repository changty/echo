// secrets.js — cross-platform secret storage with graceful degradation.
//
// Order of preference:
//   1. keytar        → real OS keychain (macOS Keychain, Windows Credential Vault,
//                      libsecret/gnome-keyring/kwallet on Linux)
//   2. safeStorage   → Electron's built-in encryption, written to a file in userData.
//                      On Linux this still wants a keyring, but falls back to a
//                      "basic" cipher so it keeps working on bare WMs.
//   3. plain file    → last resort, clearly flagged to the user in Settings.
//
// Many Linux desktops (Hyprland, sway, bare i3, minimal Arch installs) ship no
// Secret Service at all. keytar throws there, which used to take the whole
// "save API key" flow down. Now we just slide down a tier.

import fs from "fs";
import path from "path";
import { app, safeStorage } from "electron";

const SERVICE = "com.eduten.echo";

let keytar = null;
let keytarUsable = null; // null = untested
let backend = "unknown";

async function loadKeytar() {
  if (keytarUsable !== null) return keytarUsable;
  try {
    const mod = await import("keytar");
    keytar = mod.default || mod;
    // A read is the cheapest way to prove the Secret Service actually answers.
    await keytar.getPassword(SERVICE, "__probe__");
    keytarUsable = true;
  } catch (e) {
    console.warn("[secrets] keychain unavailable, falling back:", e?.message || e);
    keytar = null;
    keytarUsable = false;
  }
  return keytarUsable;
}

// ---------- file fallback ----------
const storePath = () => path.join(app.getPath("userData"), "secrets.json");

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeStore(obj) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 0600: on shared Linux boxes this is the difference between "encrypted-ish"
  // and "world readable".
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {}
}

function encryptable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// ---------- public API ----------
export async function setSecret(account, value) {
  if (!account) return { ok: false, error: "No account given" };
  if (await loadKeytar()) {
    try {
      await keytar.setPassword(SERVICE, account, value);
      backend = "keychain";
      return { ok: true, backend };
    } catch (e) {
      console.warn("[secrets] keytar write failed, falling back:", e?.message || e);
      keytarUsable = false;
    }
  }
  const store = readStore();
  if (encryptable()) {
    store[account] = { enc: safeStorage.encryptString(value).toString("base64") };
    backend = "safeStorage";
  } else {
    store[account] = { plain: value };
    backend = "plaintext";
  }
  writeStore(store);
  return { ok: true, backend };
}

export async function getSecret(account) {
  if (!account) return "";
  if (await loadKeytar()) {
    try {
      const v = await keytar.getPassword(SERVICE, account);
      if (v) return v;
    } catch (e) {
      console.warn("[secrets] keytar read failed:", e?.message || e);
      keytarUsable = false;
    }
  }
  const rec = readStore()[account];
  if (!rec) return "";
  if (rec.plain) return rec.plain;
  if (rec.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(rec.enc, "base64"));
    } catch (e) {
      console.warn("[secrets] decrypt failed:", e?.message || e);
      return "";
    }
  }
  return "";
}

export async function deleteSecret(account) {
  if (!account) return { ok: false, error: "No account given" };
  if (await loadKeytar()) {
    try {
      await keytar.deletePassword(SERVICE, account);
    } catch (e) {
      console.warn("[secrets] keytar delete failed:", e?.message || e);
    }
  }
  const store = readStore();
  if (store[account]) {
    delete store[account];
    writeStore(store);
  }
  return { ok: true };
}

export async function hasSecret(account) {
  return !!(await getSecret(account));
}

// Surfaced in Settings so the user knows whether their key is in a real
// keychain or sitting in a 0600 file.
export async function secretsStatus() {
  const kc = await loadKeytar();
  if (kc) return { backend: "keychain", secure: true, label: "OS keychain" };
  if (encryptable())
    return { backend: "safeStorage", secure: true, label: "Encrypted file (no OS keychain found)" };
  return {
    backend: "plaintext",
    secure: false,
    label: "Plaintext file — install gnome-keyring or kwallet for encryption",
  };
}
