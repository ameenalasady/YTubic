import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LayoutMode = "right" | "bottom" | "floating";

export const DEFAULT_SIDEBAR_WIDTH = 208;
export const MIN_SIDEBAR_WIDTH = 176;
export const MAX_SIDEBAR_WIDTH = 320;

export const DEFAULT_PLAYER_WIDTH = 352;
export const MIN_PLAYER_WIDTH = 320;
export const MAX_PLAYER_WIDTH = 420;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type State = {
  mode: LayoutMode;
  sidebarWidth: number;
  playerWidth: number;
  /** Always-on-top toggle for the floating-player window. Persisted
   *  so a pinned window stays pinned after a close/reopen cycle. */
  floatingPinned: boolean;
  setMode: (mode: LayoutMode) => void;
  setSidebarWidth: (width: number) => void;
  setPlayerWidth: (width: number) => void;
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
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      playerWidth: DEFAULT_PLAYER_WIDTH,
      floatingPinned: false,
      setMode: (mode) => set({ mode }),
      setSidebarWidth: (sidebarWidth) =>
        set({
          sidebarWidth: clamp(
            sidebarWidth,
            MIN_SIDEBAR_WIDTH,
            MAX_SIDEBAR_WIDTH,
          ),
        }),
      setPlayerWidth: (playerWidth) =>
        set({
          playerWidth: clamp(playerWidth, MIN_PLAYER_WIDTH, MAX_PLAYER_WIDTH),
        }),
      setFloatingPinned: (floatingPinned) => set({ floatingPinned }),
    }),
    {
      name: "ytm-layout",
      merge: (persisted, current) => {
        const stored = persisted as Partial<State>;
        return {
          ...current,
          ...stored,
          sidebarWidth: clamp(
            stored.sidebarWidth ?? current.sidebarWidth,
            MIN_SIDEBAR_WIDTH,
            MAX_SIDEBAR_WIDTH,
          ),
          playerWidth: clamp(
            stored.playerWidth ?? current.playerWidth,
            MIN_PLAYER_WIDTH,
            MAX_PLAYER_WIDTH,
          ),
        };
      },
    },
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
