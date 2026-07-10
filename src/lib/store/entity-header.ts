import { create } from "zustand";
import type { ReactNode } from "react";
import type { Thumbnail as YtThumbnail } from "@/lib/innertube/types";

/**
 * Snapshot of whatever the current route's `<EntityHeader>` published.
 * Consumed by `<EntityPageHeader>`, which renders as the first child
 * inside `<main>` (ordinary scroll content) and derives both the full
 * hero and the sticky compact bar from the same data.
 */
export type EntityHeaderConfig = {
  title: string;
  subtitle?: ReactNode;
  metadata?: string;
  description?: string;
  thumbnails: YtThumbnail[];
  round: boolean;
  onPlay?: () => void;
  onShuffle?: () => void;
  actions?: ReactNode;
};

type State = {
  config: EntityHeaderConfig | null;
  setConfig: (config: EntityHeaderConfig | null) => void;
};

export const useEntityHeaderStore = create<State>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}));
