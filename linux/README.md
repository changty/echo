# Running Echo on Linux

Electron's `globalShortcut` is an X11 key grab. On a Wayland session it is
registered against XWayland, so it fires only while an X11 window has focus —
which is exactly why the hotkey feels like it "works sometimes".

The fix is to stop asking Electron for a global hotkey and let the compositor
own the binding, calling Echo's CLI:

    echo-llm --toggle           # show if hidden, hide if visible
    echo-llm --show             # always show
    echo-llm --hide             # always hide
    echo-llm --action=proofread # open and immediately run an action
    echo-llm --action=summarize
    echo-llm --action=translate_en
    echo-llm --text="some text" # skip the clipboard, pass text directly
    echo-llm --quit

Echo holds a single-instance lock, so a second launch never starts a second
copy — it hands the flags to the already-running instance and exits.

> The binary is called `echo-llm`, not `echo`. `echo` is a POSIX shell builtin,
> and every compositor runs keybinding `exec` lines through a shell, so a
> command named `echo` would be shadowed.

## Per-compositor setup

| Compositor | Setup |
|---|---|
| Hyprland (`.conf`) | `source = /path/to/echo/linux/hyprland.conf` |
| Hyprland (Lua, Omarchy 3+) | `dofile(os.getenv("HOME") .. "/git/echo/linux/hyprland.lua")` — Lua configs have no `source` directive |
| sway | see `linux/sway.conf` |
| GNOME | Settings → Keyboard → Custom Shortcuts → `echo-llm --toggle` |
| KDE | System Settings → Shortcuts → Custom → `echo-llm --toggle` |
| X11 (i3/xfce/…) | Electron's built-in hotkey works; no extra setup needed |

## Tiling compositors: float the window

Hyprland and sway tile new windows by default, so Echo opens as a full tile
instead of a floating overlay. The supplied config files include the rules;
they match on the Wayland `app_id` / X11 class **`echo`**.

Confirm the class on your system with:

    hyprctl clients | grep -A2 -i echo     # Hyprland
    swaymsg -t get_tree | grep -i echo     # sway

### One app_id, two windows

`app_id` is a property of the process, not the window, so the launcher and the
Settings window are both `echo`. Anything that should apply to one of them has
to match the title as well — `Echo` for the launcher, `Echo Settings` for
settings:

    windowrulev2 = pin, class:^(echo)$, title:^(Echo)$          # Hyprland
    for_window [app_id="echo" title="^Echo$"] sticky enable      # sway

    o.window({ class = "^echo$", title = "^Echo$" }, { pin = true })   -- Lua

Two rules are actively harmful on the bare app_id, and the shipped configs
leave both out:

- **`stayfocused`** keeps focus on the launcher no matter what, so the Settings
  form silently swallows every keystroke. Echo's *Hide when the window loses
  focus* setting covers the same need and only applies to the launcher.
- **`pin`** / **`sticky`** raise a window above unpinned ones, so applying it to
  both windows leaves Settings stuck behind the launcher.

If Settings opens behind the launcher or refuses input, one of those two rules
is almost always the reason.

## Installing

    npm run dist:linux

produces `Echo-<version>.AppImage` and `echo-<version>.tar.gz` in `dist/`.

**Prefer the tarball on Arch and recent Fedora.** AppImages still require
*libfuse2*, which those distributions no longer ship — the AppImage aborts with
`dlopen(): error loading libfuse.so.2`. Either install the compat package
(`sudo pacman -S fuse2`) or just use the tarball, which has no such dependency:

    tar -xzf dist/echo-1.0.0.tar.gz -C ~/.local/opt/
    ln -sf ~/.local/opt/echo-1.0.0/echo-llm ~/.local/bin/echo-llm

Make sure `~/.local/bin` is on your `PATH`, and `echo-llm --toggle` in your
compositor config will then just work.

### .deb / .rpm

    npm run dist:linux:packages

These are built with `fpm`, whose bundled Ruby links against `libcrypt.so.1`.
On Arch that means installing `libxcrypt-compat` first, or the build fails with
`error while loading shared libraries: libcrypt.so.1`:

    sudo pacman -S libxcrypt-compat

They install `echo-llm` onto your `PATH` and register a desktop entry.

## API key storage

Echo tries, in order:

1. **OS keychain** via libsecret — needs `gnome-keyring` or `kwallet` running.
2. **Encrypted file** via Electron's `safeStorage`.
3. **Plaintext file** at `~/.config/Echo/secrets.json`, mode `0600`.

Settings shows which tier is in use. Bare window managers often ship no Secret
Service at all; installing `gnome-keyring` gets you tier 1:

    # Arch
    sudo pacman -S gnome-keyring libsecret
    # Debian/Ubuntu
    sudo apt install gnome-keyring libsecret-1-0

## Auto-paste (optional)

Off by default. When enabled, Echo hides itself and replays a paste keystroke
into the window that regains focus, so you never touch the clipboard manually.
It needs a helper binary:

    # wlroots compositors (Hyprland, sway, river)
    sudo pacman -S wtype           # Arch
    sudo apt install wtype         # Debian/Ubuntu

    # anything else, including GNOME Wayland (needs the ydotoold daemon)
    sudo pacman -S ydotool

    # X11
    sudo pacman -S xdotool

GNOME does not implement the virtual-keyboard protocol `wtype` relies on, so
GNOME Wayland users need `ydotool`. Settings shows which method was detected.

## Troubleshooting

**Window is a black rectangle** — your compositor lacks the blur/transparency
support Echo assumes. Settings → Linux & Wayland → *Disable window transparency*.

**Window vanishes while typing** — focus-follows-mouse. Settings → uncheck
*Hide when the window loses focus*.

**Blurry text on a HiDPI/fractional-scaling monitor** — Settings → Linux &
Wayland → Display backend → *Native Wayland*, then restart. Electron's own
hotkey stops working in that mode, so bind the compositor to `--toggle` first.

**Auto-paste does nothing** — check Settings for the detected tool. `ydotool`
additionally needs `ydotoold` running and access to `/dev/uinput`.

**No tray icon** — install a StatusNotifierItem host (`waybar` with the `tray`
module, `libappindicator-gtk3`). Tiling WMs frequently ship without one.
