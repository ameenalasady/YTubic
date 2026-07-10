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
  const fallbackUrl = useCoverLightboxStore((s) => s.fallbackUrl);
  const errored = useCoverLightboxStore((s) => s.errored);
  const markErrored = useCoverLightboxStore((s) => s.markErrored);
  const alt = useCoverLightboxStore((s) => s.alt);

  // `url` is a best-effort guess (an upgraded-resolution rewrite, or an
  // iTunes override) that doesn't always exist — drop to the
  // guaranteed-safe `fallbackUrl` on load failure, same tiered
  // philosophy as <Thumbnail>'s own error recovery.
  const src = errored && fallbackUrl ? fallbackUrl : url;

  return (
    <Dialog open={open && !!url} onOpenChange={setOpen}>
      {src ? (
        <DialogContent className="w-fit max-w-[min(90vw,40rem)] border-none bg-transparent p-0 shadow-none sm:max-w-[min(90vw,40rem)]">
          <DialogTitle className="sr-only">{alt || "Cover art"}</DialogTitle>
          <DialogDescription className="sr-only">
            Enlarged cover art
          </DialogDescription>
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            onError={() => {
              if (!errored && fallbackUrl && fallbackUrl !== src) {
                markErrored();
              }
            }}
            className="max-h-[85vh] w-full rounded-lg object-contain shadow-2xl"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
