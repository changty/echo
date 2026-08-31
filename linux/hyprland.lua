-- Echo — Hyprland integration, Lua config flavour
--
-- Hyprland's Lua config (Omarchy 3+ ships ~/.config/hypr/hyprland.lua) has no
-- `source =` directive, so pull this file in with dofile:
--
--     dofile(os.getenv("HOME") .. "/git/echo/linux/hyprland.lua")
--
-- Place that line *after* `require("default.hypr.omarchy")` so these rules win.
-- On the classic .conf syntax, use linux/hyprland.conf instead.

-- 1. The hotkey.
-- Electron's own global shortcut is an X11 key grab, so on Wayland it only
-- fires while an X11 window happens to have focus. Let Hyprland own it.
--
-- The binary is `echo-llm`, not `echo`: `echo` is a POSIX shell builtin and
-- exec lines run through a shell, so `echo --toggle` would just print it.
o.bind("ALT + SPACE", "Echo", "echo-llm --toggle")

-- Optional: jump straight to an action on the clipboard, no menu step. Any
-- custom action you add in Settings works here too, by its id.
o.bind("ALT + SHIFT + P", "Echo: proofread", "echo-llm --action=proofread")
o.bind("ALT + SHIFT + E", "Echo: translate to English", "echo-llm --action=translate_en")
o.bind("ALT + SHIFT + S", "Echo: summarize", "echo-llm --action=summarize")

-- 2. Window rules.
-- Without these Hyprland tiles the launcher like an ordinary window, which
-- destroys the whole Spotlight effect.
--
-- Echo opens two windows and Wayland gives both the same app_id (`echo`) —
-- app_id is per-process, not per-window. Match on the title to reach just one:
--   title = "^Echo$"           the launcher
--   title = "^Echo Settings$"  the settings window
o.window({ class = "^echo$" }, {
  float = true,
  center = true,
  border_size = 0,
})

-- Deliberately no `stay_focused`. It looks right for a launcher — it stops the
-- window losing focus — but app_id matches BOTH windows, so it pins focus to
-- the launcher and Settings will not accept a single keystroke. Echo has its
-- own "Hide when the window loses focus" setting, which applies to the
-- launcher only; use that instead.
--
-- Same for `pin`: pinned windows sit above unpinned ones, so pinning on the
-- app_id buries Settings behind the launcher. Scope it to the launcher if you
-- want Echo to follow you across workspaces:
-- o.window({ class = "^echo$", title = "^Echo$" }, { pin = true })

-- Deliberately no size rule. Echo resizes itself to fit its content, and
-- Settings opens at up to 90% of the work area; a fixed size leaves the
-- content scrolling inside a 320px slit and Settings clipped.

-- 3. Autostart so the hotkey is live from login.
o.launch_on_start("echo-llm --hide")
