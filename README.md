# LLM "Spotlight" (Echo)

<img width="773" height="393" alt="image" src="https://github.com/user-attachments/assets/12b55a39-5a83-43db-a762-54a559c70e59" />

A Spotlight-style launcher for quick LLM actions. Cross-platform (macOS/Windows/Linux), built with **Electron + HTML/JS** and styled with **Tailwind**.

- Pops up with a global hotkey (default **Alt+Space**)
- Auto-reads text/image from the clipboard on open
- **Actions are just prompts you configure** — the built-ins are Ask, Proofread,
  Translate → English, Translate → …, Summarize and Rewrite; add your own in Settings
- **Streams** the response as it is generated, with Cancel
- Keeps your **original text** — flip between Original and Result, or Retry
- Writes the response to the clipboard, and can optionally **paste it straight
  back** into the app you came from
- Works with **OpenAI**, **OpenAI-compatible** endpoints, **Ollama** (local) or **Gemini**

---

## Prerequisites

- **Node.js 18+** and **npm**
- An LLM provider (choose one):
  - **OpenAI** API key
  - **OpenAI-compatible** server (base URL + key)
  - **Ollama** running locally (e.g., `ollama serve` with a model like `llama3.1:8b`)

---

## Install

    git clone <this-repo> echo
    cd echo
    npm i

Create your config and env:

    cp config.example.json config.json
    # .env is NOT checked in
    printf "OPENAI_API_KEY=\nOPENAI_COMPAT_KEY=\n" > .env

Edit **config.json** to select a provider and default model.

---

## Develop

Tailwind builds CSS → Electron serves the app.

Terminal A (Tailwind watch):

    npm run tw:dev

Terminal B (Electron):

    npm run dev

Open the app with the global hotkey (**Alt+Space** by default).
Use the **⚙︎ Settings** button to change hotkey, provider, model, API base, and a default target language.

---

## Linux / Wayland

On Wayland, Electron's global hotkey is an X11 grab and only fires while an X11
window has focus — the usual "works sometimes" symptom. Let your compositor own
the binding instead, and drive Echo through its CLI:

    echo-llm --toggle            # show if hidden, hide if visible
    echo-llm --action=proofread  # open and run an action on the clipboard
    echo-llm --text="hei"        # pass text directly instead of the clipboard

Echo takes a single-instance lock, so a second launch forwards its flags to the
running instance instead of starting a second copy.

Hyprland:

    source = /path/to/echo/linux/hyprland.conf

Tiling compositors also need a rule to *float* the window, or Echo opens as a
full tile rather than an overlay. Ready-made configs live in `linux/`, and
[`linux/README.md`](linux/README.md) covers packaging, keyring setup, HiDPI and
troubleshooting.

---

## Keyboard Shortcuts

- **Mod+1 … Mod+9** – Run the first nine actions, in Settings order
- **Mod+K** – Command palette: filter and run any action by name
- **Ctrl/⌘ + Enter** – Re-run the current action
- **Esc** – Cancel a running generation, dismiss a dialog, or close the window
- Clicking outside the window (blur) also hides it — switch this off in Settings
  if your window manager uses focus-follows-mouse.

---

## Actions

An action is a label plus a prompt, stored in `config.json`. **Settings →
Actions** lets you add, edit, reorder and delete them; the first nine get
`Mod+1`…`Mod+9`, and every action is reachable by name via `Mod+K` or by id from
the command line.

    {
      "id": "commit",
      "label": "Commit msg",
      "prompt": "Turn the following diff into a concise conventional-commit message."
    }

Tick **“Ask me something before running”** to have the action prompt you first —
that answer is prepended to the text as `Label: your answer`, which is how the
built-in *Translate → …* and *Rewrite* actions work.

## Results

Running an action never destroys your input. The response streams into the box
while a small toolbar offers **Original / Result**, **Retry**, **Copy** and
(when enabled) **Paste back**. Running another action uses whatever is currently
on screen, so actions chain — summarize, then translate the summary.

## Auto-paste (optional, off by default)

Normally Echo leaves the result on your clipboard. Enable **Settings →
Auto-paste** and it will instead hide itself and send a paste keystroke to
whatever window regains focus, so a round trip is a single hotkey.

It is off by default because it types into other applications:

| Platform | Requirement |
|---|---|
| macOS | Accessibility permission (System Settings → Privacy & Security) |
| Wayland | `wtype` (wlroots/Hyprland/sway) or `ydotool` |
| X11 | `xdotool` |
| Windows | works out of the box |

Settings shows whether a supported method was found. A **custom paste command**
field is available for setups none of the built-ins cover.

## Command line

    echo-llm --toggle              # toggle the window
    echo-llm --show / --hide
    echo-llm --action=<id>         # ask | proofread | translate_en |
                                   # translate_to | summarize | rewrite_style
    echo-llm --text="..."          # use this text instead of the clipboard
    echo-llm --quit

---

## Providers

Providers are managed in **Settings → Providers**; you can configure as many as
you like and switch the default. API keys are entered there and stored by the
OS, never in `config.json`.

- **OpenAI** — API base `https://api.openai.com/v1`, model e.g. `gpt-4o-mini`
- **OpenAI-Compatible** — any gateway speaking `/chat/completions`
- **Ollama** — host `http://localhost:11434`, model e.g. `llama3.1:8b`; no key needed
- **Gemini** — API base `https://generativelanguage.googleapis.com`

### Where API keys are stored

Echo degrades gracefully rather than failing outright:

1. OS keychain (macOS Keychain, Windows Credential Vault, libsecret on Linux)
2. Encrypted file via Electron `safeStorage`
3. Plaintext file, mode `0600` — flagged in Settings

Many minimal Linux setups run no Secret Service; install `gnome-keyring` to get
tier 1.

---

## Tests

    npm test

Covers provider streaming (including chunk boundaries that split a JSON frame
mid-line, aborts and HTTP errors), tray-icon decoding and secret-storage
round-trips, plus a renderer suite that drives the real UI against mocked IPC.

`ECHO_DEBUG=1 npm run dev` mirrors renderer console output into the terminal,
which beats DevTools for a frameless hide-on-blur window.

## Package / Distribute

    npm run dist:linux    # AppImage + tar.gz
    npm run dist:mac      # dmg  (must run on macOS)
    npm run dist:win      # NSIS installer (needs Windows, or wine on Linux)

Artifacts land in `dist/`. Tailwind is rebuilt automatically by each script.

### Cross-building from Linux

| Target | From Linux |
|---|---|
| Linux AppImage / tar.gz | ✅ native |
| Linux .deb / .rpm | needs `libxcrypt-compat` (`npm run dist:linux:packages`) |
| macOS **.zip** (`.app` inside) | ✅ `electron-builder --mac zip --x64 --arm64` |
| macOS **.dmg** | ❌ macOS only — `dmg-license` will not install elsewhere |
| Windows **.zip** | ✅ `electron-builder --win zip -c.win.signAndEditExecutable=false` |
| Windows **NSIS installer** | needs `wine` |

Nothing produced off-platform is code-signed. A macOS build made on Linux is
unsigned, so Gatekeeper quarantines it — users must clear the attribute:

    xattr -cr /Applications/Echo.app

---

## Project Structure

    .
    ├─ main.js             # Electron main process (ESM)
    ├─ secrets.js          # API-key storage w/ keychain → safeStorage → file
    ├─ autopaste.js        # Optional paste-back into the focused app
    ├─ preload.cjs         # Preload (CommonJS) exposing window.api
    ├─ assets/             # Tray + app icons
    ├─ linux/              # Compositor configs & Linux notes
    ├─ src/
    │  ├─ renderer.html    # UI shell
    │  ├─ renderer.js      # UI logic & actions
    │  ├─ tw.css           # Tailwind entry (source)
    │  └─ styles.css       # Generated by Tailwind (do not edit)
    ├─ providers/
    │  ├─ providerManager.js
    │  ├─ stream.js        # SSE / NDJSON incremental readers
    │  ├─ openai.js
    │  ├─ gemini.js
    │  └─ ollama.js
    └─ test/               # npm test

---

## Troubleshooting

- **Window doesn’t react / buttons “do nothing”**

  - Ensure `preload.cjs` is used in `webPreferences.preload` (path built with `__dirname`).
  - Open DevTools in dev:
    win.webContents.openDevTools({ mode: 'detach' })
  - Check the Console for errors.

- **“Unable to load preload script”**

  - Confirm the file exists and that the preload path uses `__dirname` (not `process.cwd()`).
  - Keep preload as **CommonJS** (`preload.cjs`).

- **`window.api` is undefined in renderer**

  - Preload didn’t load. Fix the preload path or syntax.

- **Global hotkey doesn’t work**

  - On **Wayland** this is expected — see [Linux / Wayland](#linux--wayland) and
    bind your compositor to `echo-llm --toggle`.
  - Otherwise another app may own the combination; pick a different one in
    **Settings** (⚙︎).

- **Ollama not responding**
  - Verify `ollama serve` is running and the model is pulled:
    ollama run llama3.1:8b

---

## Security Notes

- `contextIsolation: true` in the BrowserWindow
- Minimal CSP in `renderer.html` (`script-src 'self'`)
- API keys live in the OS keychain, never in `config.json` or the repo
- Single-instance lock; the CLI talks to the running instance over Electron IPC
