import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeLocalStorage } from "./safe-storage";

/**
 * Seed order matching what a typical signed-in home feed shows today.
 * The home feed carries no stable server-side id per shelf (see
 * `lib/innertube/home.ts` — the client-synthesized `Shelf.id` embeds a
 * per-page cursor hash, so it changes across refreshes), so the section
 * **title string** is the only identifier we can key an ordering
 * preference on. Titles this user hasn't seen yet (new sections, or
 * dynamic ones like an artist-name shelf) get appended the first time
 * `register` sees them, so they still show up in the reorder list.
 */
export const DEFAULT_HOME_SECTION_ORDER: string[] = [
  "Listen again",
  "New releases",
  "Your daily discover",
  "Forgotten favorites",
  "Quick picks",
  "Albums for you",
  "R&B & soul",
  "Music videos for you",
  "Mixed for you",
  "Featured playlists for you",
  "Fresh finds",
  "Old favorites",
  "All-time essentials",
  "From your library",
  "Shows for you",
  "Trending songs for you",
  "From the community",
  "Live performances",
  "Long listen",
  "Recaps",
  "Charts",
  "Covers and remixes",
];

type State = {
  /** Ordered section titles — index is the user's preferred rank. */
  order: string[];
  /**
   * Becomes `true` the first time the user reorders a section. Gates
   * both the home route's eager-load-then-sort behavior and whether
   * the settings list should be treated as "customized" (vs. just
   * showing the default order it hasn't been asked to apply yet).
   */
  customized: boolean;
  /** Move the title at `from` to `to`, splice-style (same shape as
   *  `pinned-playlists.ts`'s `reorder`). */
  reorder: (from: number, to: number) => void;
  /** Append any titles not already known, preserving their relative
   *  order — called as the home feed loads so newly-seen or rotated
   *  sections still show up in the settings list. */
  register: (titles: string[]) => void;
  /** Back to the seed order, and un-set `customized` so the home route
   *  goes back to plain lazy infinite scroll. */
  resetToDefault: () => void;
};

export const useHomeSectionsStore = create<State>()(
  persist(
    (set) => ({
      order: DEFAULT_HOME_SECTION_ORDER,
      customized: false,
      reorder: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || to < 0) return s;
          if (from >= s.order.length || to >= s.order.length) return s;
          const next = s.order.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { order: next, customized: true };
        }),
      register: (titles) =>
        set((s) => {
          const known = new Set(s.order);
          const additions = titles.filter((t) => t && !known.has(t));
          if (additions.length === 0) return s;
          return { order: [...s.order, ...additions] };
        }),
      resetToDefault: () =>
        set({ order: DEFAULT_HOME_SECTION_ORDER, customized: false }),
    }),
    {
      name: "ytm-home-order",
      // `register` writes from inside the Home route's effect on every
      // page load (see `routes/index.tsx`) — the same "runs from a
      // passive effect, not a user click" shape as `track-source.ts` /
      // `track-meta.ts`. WebKitGTK's storage quota is tight enough that
      // an unguarded write there can throw straight past this store into
      // the router's error boundary; `safeLocalStorage` swallows that
      // instead (see its doc comment for the full story).
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ order: s.order, customized: s.customized }),
    },
  ),
);

// The main and floating-player windows are separate JS contexts sharing
// the `ytm-home-order` localStorage key (same pattern as `settings.ts`
// and `layout.ts`). The floating window never renders the home feed,
// but keeping this in sync costs nothing and avoids a stale read if
// that ever changes.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "ytm-home-order") {
      void useHomeSectionsStore.persist.rehydrate();
    }
  });
}
