import { create } from "zustand";

type State = {
  open: boolean;
  url: string | null;
  alt: string;
  setOpen: (v: boolean) => void;
};

/**
 * Backs the single `<CoverLightboxDialog>` mounted once in AppShell
 * (same pattern as settings-dialog.ts / channel-picker.ts). Any cover
 * art click — the album/artist/playlist hero, the side-card cover, the
 * bottom-bar cover — calls `openCoverLightbox` with whatever `<img>`
 * src the clicked `<Thumbnail>` is already rendering (see
 * `getRenderedThumbnailSrc` in shared/thumbnail.tsx) — it's already
 * proven to load, so there's no separate fallback tier to manage here.
 */
export const useCoverLightboxStore = create<State>((set) => ({
  open: false,
  url: null,
  alt: "",
  setOpen: (open) => set({ open }),
}));

export function openCoverLightbox(url: string, alt: string) {
  useCoverLightboxStore.setState({ open: true, url, alt });
}
