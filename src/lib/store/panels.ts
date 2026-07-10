import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Px bounds and defaults for the resizable panels. Defaults match the
 *  widths these panels used before they became resizable (13rem / 22rem). */
export const SIDEBAR_MIN = 176; // 11rem
export const SIDEBAR_MAX = 320; // 20rem
export const SIDEBAR_DEFAULT = 208; // 13rem

export const CARD_MIN = 288; // 18rem
export const CARD_MAX = 480; // 30rem
export const CARD_DEFAULT = 352; // 22rem

/** Gap between the side card and the window edge (matches the card's
 *  own `right-2` / `bottom-2` inset), and the extra breathing room the
 *  content column reserves beyond the card's own width. */
export const CARD_EDGE_GAP = 8;
export const CARD_CONTENT_GAP = 16;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(v)));
}

type State = {
  sidebarWidth: number;
  cardWidth: number;
  setSidebarWidth: (v: number) => void;
  setCardWidth: (v: number) => void;
  resetSidebarWidth: () => void;
  resetCardWidth: () => void;
};

/**
 * Persisted user-chosen widths for the left sidebar and the right
 * side card. Only the main window renders either panel, so no
 * cross-window sync is needed (unlike `layout.ts` / `settings.ts`).
 */
export const usePanelsStore = create<State>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT,
      cardWidth: CARD_DEFAULT,
      setSidebarWidth: (v) =>
        set({ sidebarWidth: clamp(v, SIDEBAR_MIN, SIDEBAR_MAX) }),
      setCardWidth: (v) => set({ cardWidth: clamp(v, CARD_MIN, CARD_MAX) }),
      resetSidebarWidth: () => set({ sidebarWidth: SIDEBAR_DEFAULT }),
      resetCardWidth: () => set({ cardWidth: CARD_DEFAULT }),
    }),
    { name: "ytm-panels" },
  ),
);
