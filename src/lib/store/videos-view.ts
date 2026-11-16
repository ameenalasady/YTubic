import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewLayout = "list" | "cards";
export type CardSize = "small" | "medium" | "big";

type State = {
  /** The user's pick for video lists. `null` = never chosen: each page
   *  keeps its own default (a list on pages that always were one, cards
   *  on pages that always were a grid). */
  layout: ViewLayout | null;
  /** How many cards fit in a row (small 7, medium 5, big 3). */
  size: CardSize;
  setLayout: (layout: ViewLayout) => void;
  setSize: (size: CardSize) => void;
};

/**
 * How an artist's video list is shown: list or thumbnail cards, and how big
 * the cards are. One preference for every video list, persisted, so
 * choosing cards once keeps cards on the next artist too.
 */
export const useVideosViewStore = create<State>()(
  persist(
    (set) => ({
      layout: null,
      size: "small",
      setLayout: (layout) => set({ layout }),
      setSize: (size) => set({ size }),
    }),
    { name: "ytm-videos-view" },
  ),
);
