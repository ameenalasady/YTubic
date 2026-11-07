import { Skeleton } from "@/components/ui/skeleton";
import {
  TRACK_ROW_HEIGHT,
  trackGridTemplate,
} from "@/components/shared/track-list";
import { useSettingsStore } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

/**
 * Shared loading placeholders, sized to match the real components they
 * stand in for — so the swap from skeleton to live data doesn't pop.
 *
 * Reference dimensions (from the real components):
 *   EntityPageHeader cover: 148×148px
 *   EntityPageHeader title: text-[40px] leading-[1.15] → ~46px
 *   EntityPageHeader subtitle: text-sm → ~20px
 *   EntityPageHeader metadata: text-xs → ~16px
 *   TrackRow: TRACK_ROW_HEIGHT (56px) + 2px gap, columns from trackGridTemplate
 *   ShelfCard: text-sm title (~20px), text-xs subtitle (~16px), gap-0.5 between them
 */

/** Matches `ShelfCard`'s real geometry (shared/shelf-card.tsx); videos
 *  get the same 16:9 thumbnail the real video card uses. */
export function ShelfCardSkeleton({ video = false }: { video?: boolean } = {}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg p-2">
      <Skeleton
        className={cn(
          "w-full rounded-md",
          video ? "aspect-video" : "aspect-square",
        )}
      />
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/** A `ShelfCarousel` section: the real title (`text-xl font-semibold`,
 *  28px line height → h-7) followed by a row of cards at the same
 *  responsive widths the real carousel uses. */
export function ShelfSectionSkeleton({
  titleWidth = "w-64",
  cardCount = 6,
}: {
  titleWidth?: string;
  cardCount?: number;
}) {
  return (
    <section className="flex flex-col gap-3">
      {/* `ml-1`: the real heading sits in a `px-1` row. */}
      <Skeleton className={`ml-1 h-7 ${titleWidth}`} />
      <div className="flex gap-2 overflow-hidden pb-1">
        {Array.from({ length: cardCount }).map((_, i) => (
          <div key={i} className="w-44 shrink-0 md:w-48 lg:w-52">
            <ShelfCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One `TrackRow` (shared/track-list.tsx), built on the same grid
 * template and row height: thumb (or index) and a one-line title, then
 * artist, album, duration or plays, and the actions column, which stays
 * empty because a real row only shows its faint ⋯ there.
 */
export function TrackRowSkeleton({
  hideThumbnails = false,
  hideAlbum = false,
  showPlays = false,
}: {
  hideThumbnails?: boolean;
  hideAlbum?: boolean;
  showPlays?: boolean;
} = {}) {
  const wideActions = useSettingsStore((s) => s.ratingButtons === "both");
  return (
    <div
      className="grid items-center gap-3 rounded-lg p-2"
      style={{
        gridTemplateColumns: trackGridTemplate({
          showAlbum: !hideAlbum,
          showPlays,
          wideActions,
        }),
        height: TRACK_ROW_HEIGHT,
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center">
          {hideThumbnails ? (
            <Skeleton className="h-3 w-3" />
          ) : (
            <Skeleton className="size-10 rounded-sm" />
          )}
        </div>
        <Skeleton className="h-3.5 w-3/5" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      {hideAlbum ? null : <Skeleton className="h-3 w-1/2" />}
      <Skeleton
        className={cn("h-3 justify-self-end", showPlays ? "w-14" : "w-8")}
      />
      <div />
    </div>
  );
}

export function TrackRowSkeletonList({
  count,
  hideThumbnails = false,
  hideAlbum = false,
  showPlays = false,
}: {
  count: number;
  hideThumbnails?: boolean;
  hideAlbum?: boolean;
  showPlays?: boolean;
}) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ paddingBottom: 2 }}>
          <TrackRowSkeleton
            hideThumbnails={hideThumbnails}
            hideAlbum={hideAlbum}
            showPlays={showPlays}
          />
        </div>
      ))}
    </div>
  );
}
