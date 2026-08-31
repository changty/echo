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

Tiling compositors also need a rule to *float* the window, or Echo opens as a
full tile rather than an overlay.

### The `linux/` folder

Ready-made compositor configuration, so you do not have to work the rules out
from scratch:

| File | What it is |
|---|---|
| [`linux/hyprland.conf`](linux/hyprland.conf) | Hyprland, classic `.conf` syntax — hotkeys, window rules, autostart |
| [`linux/hyprland.lua`](linux/hyprland.lua) | The same, for Hyprland's Lua config (Omarchy 3+) |
| [`linux/sway.conf`](linux/sway.conf) | sway equivalents |
| [`linux/README.md`](linux/README.md) | Packaging, keyring setup, auto-paste helpers, HiDPI, troubleshooting |

### Installing on Hyprland

1. **Build and unpack.** Prefer the tarball on Arch: AppImages still want
   *libfuse2*, which Arch no longer ships.

       npm run dist:linux
       tar -xzf dist/echo-1.0.0.tar.gz -C ~/.local/opt/
       ln -sfn ~/.local/opt/echo-1.0.0 ~/.local/opt/echo
       ln -sf  ~/.local/opt/echo/echo-llm ~/.local/bin/echo-llm

   The `echo` symlink means only that one link moves on the next upgrade.
   Make sure `~/.local/bin` is on your `PATH`.

2. **Wire up the compositor.** In `~/.config/hypr/hyprland.conf`:

       source = ~/git/echo/linux/hyprland.conf

   Hyprland's Lua config has no `source` directive, so in
   `~/.config/hypr/hyprland.lua`, *after* `require("default.hypr.omarchy")`:

       dofile(os.getenv("HOME") .. "/git/echo/linux/hyprland.lua")

3. **Reload** with `hyprctl reload`, then press **Alt+Space**.

That gives you the hotkey, the float/center rules, and an `exec-once` that
starts Echo hidden so the first press is instant rather than a cold boot.

### Window rules: match the title, not just the app_id

Echo opens **two** windows — the launcher and Settings — and Wayland gives both
the same `app_id`, because app_id is per *process*, not per window. Rules meant
for one of them have to match the title too:

    title:^(Echo)$            # the launcher
    title:^(Echo Settings)$   # the settings window

Two rules in particular must **not** be applied to the bare app_id:

- **`stayfocused`** pins keyboard focus to the launcher, so the Settings form
  will not accept a single keystroke. Echo's own *Hide when the window loses
  focus* setting does the same job and applies to the launcher only.
- **`pin`** (sway: `sticky`) draws the window above unpinned ones, which buries
  Settings behind the launcher. Scope it to `title:^(Echo)$` if you want it.

The shipped configs leave both out and explain the trade-off inline.

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
| macOS **.dmg** | ❌ macOS only — `dmg-license` will not install elsewhere; see signing below |
| Windows **.zip** | ✅ `electron-builder --win zip -c.win.signAndEditExecutable=false` |
| Windows **NSIS installer** | needs `wine` |

### macOS code signing (no Apple Developer account)

Shipping a macOS app that opens with a double-click needs a **Developer ID**
certificate from the paid Apple Developer Program, plus notarization. Without
one you can still build and run Echo on your own machines — you just have to
sign it *ad hoc* yourself.

**Why the build complains.** electron-builder looks for a signing identity and
fails when it finds none. Tell it not to bother, in `package.json`:

    "mac": {
      "identity": null
    }

It then logs `skipped macOS code signing` and produces an unsigned `.app`.

**Why unsigned is not enough on Apple Silicon.** arm64 macOS refuses to execute
code with no valid signature at all. Electron's own binaries arrive ad-hoc
signed, but packaging rewrites `Info.plist`, renames the binary and injects the
asar, which invalidates that signature. The result launches on Intel and dies on
Apple Silicon with *"Echo is damaged and can't be opened"* — which is a broken
signature, not a corrupted download.

**Fix: ad-hoc sign it.** The `-` identity means "sign with no certificate". Run
this on macOS, after building:

    codesign --force --deep --sign - "dist/mac-arm64/Echo.app"    # Apple Silicon
    codesign --force --deep --sign - "dist/mac/Echo.app"          # Intel

    # confirm it took
    codesign --verify --verbose=2 "dist/mac-arm64/Echo.app"

`--deep` is deprecated for production signing, but it is the least fiddly way to
cover Electron's nested helper apps and frameworks for local use.

**Clear the quarantine flag.** Anything that arrives by download, AirDrop or a
transferred `.zip` is tagged `com.apple.quarantine`, and Gatekeeper blocks it
regardless of the ad-hoc signature. An app you built locally is not tagged, so
this is only needed for copies moved between machines:

    xattr -dr com.apple.quarantine /Applications/Echo.app

If Gatekeeper still refuses, right-click the app → **Open** once, or allow it
under System Settings → Privacy & Security.

**Repeated keychain password prompts.** macOS decides whether to let an app read
a keychain item by matching the app against the item's ACL — and it identifies
the app by its *code signature*. An unsigned build has nothing to match, and an
**ad-hoc signature is not stable**: `codesign --sign -` mints a fresh identity on
every build, so even clicking **Always Allow** will not survive your next
rebuild. macOS therefore asks again.

Echo caches each key in memory for the lifetime of the process, so at worst you
are asked once per provider per launch, never once per request. To stop the
prompts entirely, sign with a **stable self-signed certificate** instead of
ad-hoc:

1. Keychain Access → *Certificate Assistant* → **Create a Certificate…**
2. Name it e.g. `Echo Self Signed`, Identity Type **Self Signed Root**,
   Certificate Type **Code Signing**.
3. Sign with it, using that name in place of `-`:

        codesign --force --deep --sign "Echo Self Signed" "dist/mac-arm64/Echo.app"

Because that identity is stable across rebuilds, **Always Allow** sticks and the
prompts stop. Use the same name in the `afterPack` hook above.

**What this does not give you.** An ad-hoc signature is trusted only where you
choose to trust it. Anyone else you hand the app to sees the same warnings, so
this is fine for your own machines and not a distribution strategy. It is also
unrelated to the *Accessibility* permission that auto-paste needs — macOS ties
that grant to the signature, so re-signing can make the system treat Echo as a
new app and ask again.

**If you build a `.dmg`, sign during the build, not after.** `npm run dist:mac`
seals the `.app` inside the disk image, so hand-signing afterwards is too late —
the copy users drag out stays broken. electron-builder's `afterPack` hook runs
once the bundle exists but before the `.dmg` is assembled, which is the right
moment. Save this as `build/adhoc-sign.cjs`:

    // Ad-hoc sign the .app so it runs on Apple Silicon without a
    // Developer ID. No-op anywhere except macOS builds.
    const { execFileSync } = require("child_process");
    const path = require("path");

    exports.default = async function adhocSign(context) {
      if (context.electronPlatformName !== "darwin") return;
      if (process.platform !== "darwin") return; // codesign only exists on macOS
      const app = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`
      );
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
        stdio: "inherit",
      });
    };

and point `build.afterPack` at it in `package.json`:

    "build": {
      "afterPack": "build/adhoc-sign.cjs",
      "mac": { "identity": null }
    }

Builds produced on Linux are never signed at all, so they always need the
`codesign` step above before they will run on Apple Silicon.

---

## Project Structure

    .
    ├─ main.js             # Electron main process (ESM)
    ├─ secrets.js          # API-key storage w/ keychain → safeStorage → file
    ├─ autopaste.js        # Optional paste-back into the focused app
    ├─ preload.cjs         # Preload (CommonJS) exposing window.api
    ├─ assets/             # Tray + app icons
    ├─ linux/              # Compositor configs & Linux notes
    │  ├─ hyprland.conf    # Hyprland, classic .conf syntax
    │  ├─ hyprland.lua     # Hyprland, Lua config (Omarchy 3+)
    │  ├─ sway.conf        # sway
    │  └─ README.md        # Packaging, keyring, auto-paste, HiDPI
    ├─ src/
    │  ├─ renderer.html    # UI shell
    │  ├─ renderer.js      # UI logic & actions
    │  ├─ settings.html    # Settings window
    │  ├─ settings.js      # Settings logic
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

- **macOS asks for the keychain password repeatedly**

  - Expected for unsigned or ad-hoc-signed builds: the keychain ACL identifies
    apps by code signature, and an ad-hoc one changes every build. Sign with a
    stable self-signed certificate — see
    [macOS code signing](#macos-code-signing-no-apple-developer-account).
  - Echo caches keys per process, so this is at most once per provider per
    launch. If you are asked on *every* request, you are running an old build.

- **Ollama not responding**
  - Verify `ollama serve` is running and the model is pulled:
    ollama run llama3.1:8b

---

## Security Notes

- `contextIsolation: true` in the BrowserWindow
- Minimal CSP in `renderer.html` (`script-src 'self'`)
- API keys live in the OS keychain, never in `config.json` or the repo
- Single-instance lock; the CLI talks to the running instance over Electron IPC
