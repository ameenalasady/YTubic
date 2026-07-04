import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LayoutMode = "right" | "bottom" | "floating";

type State = {
  mode: LayoutMode;
  /** Always-on-top toggle for the floating-player window. Persisted
   *  so a pinned window stays pinned after a close/reopen cycle. */
  floatingPinned: boolean;
  setMode: (mode: LayoutMode) => void;
  setFloatingPinned: (v: boolean) => void;
};

/**
 * Player layout preference. Three modes:
 *  - `right`    — fixed card on the right side of the window (default)
 *  - `bottom`   — compact horizontal bar pinned to the bottom of the page
 *  - `floating` — separate Tauri window that floats independently
 *
 * Persisted in localStorage so the user's choice survives restarts. The
 * floating window auto-spawns on startup if `floating` was the last
 * picked mode (logic in `app-shell.tsx`).
 */
export const useLayoutStore = create<State>()(
  persist(
    (set) => ({
      mode: "right",
      floatingPinned: false,
      setMode: (mode) => set({ mode }),
      setFloatingPinned: (floatingPinned) => set({ floatingPinned }),
    }),
    { name: "ytm-layout" },
  ),
);

// The main and floating-player windows are separate JS contexts that share
// the `ytm-layout` localStorage key. Without cross-window sync, a change in
// one (e.g. the floating window toggling `floatingPinned`) is invisible to
// the other, whose next `setMode` then clobbers it with a stale value. The
// `storage` event fires in the OTHER window on write, so re-hydrate from it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "ytm-layout") {
      void useLayoutStore.persist.rehydrate();
    }
  });
}
