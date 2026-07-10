import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCoverLightboxStore } from "@/lib/store/cover-lightbox";

/**
 * Full-size cover art popup. Opened by clicking a cover in the
 * album/artist/playlist hero or the player card (side card / bottom
 * bar) — see `openCoverLightbox` (lib/store/cover-lightbox.ts). Just
 * the image: no header/footer chrome, closed via the default X,
 * outside click, or Escape.
 */
export function CoverLightboxDialog() {
  const open = useCoverLightboxStore((s) => s.open);
  const setOpen = useCoverLightboxStore((s) => s.setOpen);
  const url = useCoverLightboxStore((s) => s.url);
  const alt = useCoverLightboxStore((s) => s.alt);

  return (
    <Dialog open={open && !!url} onOpenChange={setOpen}>
      {url ? (
        <DialogContent className="w-fit max-w-[min(90vw,40rem)] border-none bg-transparent p-0 shadow-none sm:max-w-[min(90vw,40rem)]">
          <DialogTitle className="sr-only">{alt || "Cover art"}</DialogTitle>
          <DialogDescription className="sr-only">
            Enlarged cover art
          </DialogDescription>
          <img
            src={url}
            alt={alt}
            referrerPolicy="no-referrer"
            className="max-h-[85vh] w-full rounded-lg object-contain shadow-2xl"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
