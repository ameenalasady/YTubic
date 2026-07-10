import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading placeholders, sized to match the real components they
 * stand in for — so the swap from skeleton to live data doesn't pop.
 * Kept in one place because `ShelfCard` / `TrackRow`'s geometry is
 * reused across Home, Explore-family feeds, Search, and Library.
 */

/** Matches `ShelfCard`'s real geometry (shared/shelf-card.tsx): an
 *  outer `gap-2` between the cover and the text block, but only
 *  `gap-0.5` between the title and subtitle lines inside it — using a
 *  uniform gap for all three (the bug this replaces) sits the subtitle
 *  line noticeably lower than the real card does. */
export function ShelfCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2">
      <Skeleton className="aspect-square w-full" />
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/** A `ShelfCarousel` section: the real title (`text-xl font-semibold`,
 *  28px line height → h-7, not h-6) followed by a row of cards at the
 *  same responsive widths the real carousel uses. */
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
      <div className="flex gap-2 overflow-hidden pb-3">
        {Array.from({ length: cardCount }).map((_, i) => (
          <div key={i} className="w-44 shrink-0 md:w-48 lg:w-52">
            <ShelfCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Matches one `TrackRow` (shared/track-list.tsx): 56px tall
 *  (`ROW_SIZE`), `p-2` padding, a 40px thumb, and the same `gap-3`
 *  between the thumb/text block and the trailing duration column. Real
 *  rows stack with zero gap between them (absolute-positioned by the
 *  virtualizer) — callers should render these in a plain `flex-col`
 *  with no gap, not a gapped list. */
export function TrackRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2">
      <Skeleton className="size-10 shrink-0 rounded-sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-3 w-10 shrink-0" />
    </div>
  );
}

export function TrackRowSkeletonList({ count }: { count: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <TrackRowSkeleton key={i} />
      ))}
    </div>
  );
}
