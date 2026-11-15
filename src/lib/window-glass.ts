import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_LINUX } from "@/lib/platform";
import { useSettingsStore } from "@/lib/store/settings";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Linux "glass" window: the desktop shows through the window fill, and
 * the compositor blurs it if it is set up to (KWin's blur effects match
 * on the window class `ytubic`).
 *
 * The Linux windows are always created transparent (`transparent` in
 * `tauri.linux.conf.json`, `.transparent(true)` on the floating player),
 * because transparency can't be switched on after creation. All of the
 * setting therefore lives in CSS, driven from here through two
 * attributes on `<html>`:
 *
 *   data-glass       the setting is on; `--win-alpha` holds the fill's
 *                    alpha. Off leaves the fill fully opaque, i.e. the
 *                    window looks exactly as it did before transparency.
 *   data-win-square  the window is maximized or fullscreen, so the
 *                    rounded corners drop away.
 *
 * `index.html` sets the same attributes from the persisted settings
 * before first paint, so the window doesn't flash opaque then clear.
 */
export function useWindowGlass() {
  const enabled = useSettingsStore((s) => s.transparentWindow);
  const opacity = useSettingsStore((s) => s.windowOpacity);

  useEffect(() => {
    if (!IS_LINUX) return;
    const root = document.documentElement;
    root.toggleAttribute("data-glass", enabled);
    if (enabled) root.style.setProperty("--win-alpha", String(opacity / 100));
    else root.style.removeProperty("--win-alpha");
  }, [enabled, opacity]);

  useEffect(() => {
    if (!IS_LINUX || !IS_TAURI) return;
    const root = document.documentElement;
    const win = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      Promise.all([win.isMaximized(), win.isFullscreen()])
        .then(([max, full]) => {
          if (!cancelled) root.toggleAttribute("data-win-square", max || full);
        })
        .catch(() => {});
    };
    sync();
    // Same cancelled-flag pattern as the title bar's maximize tracking:
    // `onResized` resolves async, possibly after StrictMode's cleanup ran.
    win
      .onResized(sync)
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
