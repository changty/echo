// autopaste.js — optionally paste the result straight back into whatever app
// had focus, instead of leaving it on the clipboard for the user to paste.
//
// This is OFF by default and gated behind config.autoPaste.enabled, because it
// synthesises input events into another application: on macOS it needs
// Accessibility permission, and on Wayland it needs a helper binary that not
// every system has.

import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
const IS_WAYLAND =
  IS_LINUX &&
  (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);

async function exists(bin) {
  try {
    await run("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

// Returns [command, args] for a "press paste" keystroke, or null when no
// supported method is available on this machine.
async function pasteStrategy() {
  if (IS_MAC) {
    return [
      "osascript",
      ["-e", 'tell application "System Events" to keystroke "v" using command down'],
    ];
  }

  if (IS_WIN) {
    return [
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "$w = New-Object -ComObject wscript.shell; $w.SendKeys('^v')",
      ],
    ];
  }

  if (IS_LINUX) {
    if (IS_WAYLAND) {
      // wtype speaks the virtual-keyboard protocol; works on wlroots (Hyprland,
      // sway) but not on GNOME, which does not implement that protocol.
      if (await exists("wtype")) return ["wtype", ["-M", "ctrl", "-k", "v", "-m", "ctrl"]];
      // ydotool goes through /dev/uinput, so it works anywhere — but needs the
      // ydotoold daemon running and permission on the device node.
      if (await exists("ydotool")) return ["ydotool", ["key", "29:1", "47:1", "47:0", "29:0"]];
      return null;
    }
    if (await exists("xdotool"))
      return ["xdotool", ["key", "--clearmodifiers", "ctrl+v"]];
    return null;
  }

  return null;
}

export async function autoPasteCapability() {
  const strategy = await pasteStrategy();
  if (strategy) return { available: true, tool: strategy[0] };

  return {
    available: false,
    tool: null,
    hint: IS_WAYLAND
      ? "Install `wtype` (wlroots compositors) or `ydotool` to paste automatically."
      : IS_LINUX
      ? "Install `xdotool` to paste automatically."
      : "No supported paste tool found on this system.",
  };
}

// `delayMs` gives the compositor time to hand focus back to the previously
// active window; pasting into a window that is still losing focus goes nowhere.
export async function pasteToFocusedApp({ custom, delayMs = 120 } = {}) {
  await new Promise((r) => setTimeout(r, delayMs));

  try {
    if (custom && custom.trim()) {
      // User-supplied escape hatch for setups none of the built-ins cover.
      // Their own config file, their own command — run it via the shell so
      // pipes and arguments behave as written.
      const { exec } = await import("child_process");
      await promisify(exec)(custom);
      return { ok: true, tool: "custom" };
    }

    const strategy = await pasteStrategy();
    if (!strategy) return { ok: false, error: (await autoPasteCapability()).hint };

    await run(strategy[0], strategy[1]);
    return { ok: true, tool: strategy[0] };
  } catch (e) {
    const msg = e?.stderr || e?.message || String(e);
    if (IS_MAC && /not allowed|assistive|1719/i.test(msg)) {
      return {
        ok: false,
        error:
          "macOS blocked the keystroke. Grant Echo access under System Settings → Privacy & Security → Accessibility.",
      };
    }
    return { ok: false, error: msg };
  }
}
