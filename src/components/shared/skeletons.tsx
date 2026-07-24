import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading placeholders, sized to match the real components they
 * stand in for — so the swap from skeleton to live data doesn't pop.
 *
 * Reference dimensions (from the real components):
 *   EntityPageHeader cover: 148×148px
 *   EntityPageHeader title: text-[40px] leading-[1.15] → ~46px
 *   EntityPageHeader subtitle: text-sm → ~20px
 *   EntityPageHeader metadata: text-xs → ~16px
 *   TrackRow height: ROW_SIZE=58px + 2px paddingBottom
 *   TrackRow grid: [~40px thumb] [1fr title/artist] [auto album] [3.5rem duration] [4rem actions]
 *   ShelfCard: text-sm title (~20px), text-xs subtitle (~16px), gap-0.5 between them
 */

/** Matches `ShelfCard`'s real geometry (shared/shelf-card.tsx). */
export function ShelfCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg p-2">
      <Skeleton className="aspect-square w-full rounded-md" />
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
      <Skeleton className={`h-7 ${titleWidth}`} />
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
 * Matches one `TrackRow` (shared/track-list.tsx): 58px tall
 * (`ROW_SIZE`), `p-2` padding, a 40px thumb, and a grid layout
 * matching the real columns.
 */
export function TrackRowSkeleton({
  hideThumbnails = false,
  hideAlbum = false,
}: {
  hideThumbnails?: boolean;
  hideAlbum?: boolean;
} = {}) {
  return (
    <div
      className="grid items-center gap-3 rounded-lg p-2"
      style={{
        gridTemplateColumns: `${hideThumbnails ? "2.5rem" : "2.5rem"} minmax(0,1fr) ${hideAlbum ? "" : "minmax(0,1fr) "}3.5rem 4rem`,
        height: 58,
      }}
    >
      {hideThumbnails ? (
        <Skeleton className="h-4 w-4 justify-self-center" />
      ) : (
        <Skeleton className="size-10 shrink-0 rounded-sm" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      {!hideAlbum && (
        <Skeleton className="h-4 w-3/4" />
      )}
      <Skeleton className="h-4 w-10 justify-self-end" />
      <div className="flex items-center gap-1">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
      </div>
    </div>
  );
}

export function TrackRowSkeletonList({
  count,
  hideThumbnails = false,
  hideAlbum = false,
}: {
  count: number;
  hideThumbnails?: boolean;
  hideAlbum?: boolean;
}) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ paddingBottom: 2 }}>
          <TrackRowSkeleton hideThumbnails={hideThumbnails} hideAlbum={hideAlbum} />
        </div>
      ))}
    </div>
  );
}
