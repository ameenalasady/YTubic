import { create } from "zustand";

type State = {
  open: boolean;
  url: string | null;
  /** Guaranteed-to-exist API-shipped thumbnail, shown if `url` (the
   *  higher-res guess, or an iTunes override) fails to load — a
   *  `maxresdefault` upgrade guess 404s for plenty of videos, and an
   *  iTunes lookup can fail independently of the track's own art. */
  fallbackUrl: string | null;
  errored: boolean;
  alt: string;
  setOpen: (v: boolean) => void;
  markErrored: () => void;
};

/**
 * Backs the single `<CoverLightboxDialog>` mounted once in AppShell
 * (same pattern as settings-dialog.ts / channel-picker.ts). Any cover
 * art click — the album/artist/playlist hero, the side-card cover, the
 * bottom-bar cover — calls `openCoverLightbox` with an already-resolved
 * max-res URL (see `resolveMaxCoverUrl` in shared/thumbnail.tsx) plus a
 * safe fallback (see `pickHighResThumbnail`).
 */
export const useCoverLightboxStore = create<State>((set) => ({
  open: false,
  url: null,
  fallbackUrl: null,
  errored: false,
  alt: "",
  setOpen: (open) => set({ open }),
  markErrored: () => set({ errored: true }),
}));

export function openCoverLightbox(
  url: string,
  fallbackUrl: string | null,
  alt: string,
) {
  useCoverLightboxStore.setState({
    open: true,
    url,
    fallbackUrl,
    errored: false,
    alt,
  });
}
