import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { fetchHomeFeedPage } from "@/lib/innertube/home";
import { ShelfCarousel } from "@/components/shared/shelf-carousel";
import { ShelfSectionSkeleton } from "@/components/shared/skeletons";
import { useHomeSectionsStore } from "@/lib/store/home-sections";
import type { Shelf } from "@/lib/innertube/types";
import { IconAlertCircle, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ErrorCard } from "@/components/shared/error-card";

export const Route = createFileRoute("/")({
  component: HomePage,
});

/**
 * Stable-sort shelves by the user's saved title order (see
 * `lib/store/home-sections.ts`). Titles not in `order` (a section
 * that's new or has rotated in since the order was saved) rank last,
 * in their original API position. `(a.rank - b.rank) || (a.i - b.i)`
 * relies on `NaN` being falsy in JS — when both ranks are `Infinity`,
 * `Infinity - Infinity` is `NaN`, and `||` falls through to the index
 * tiebreak instead of leaving the comparator result undefined.
 */
function sortShelvesByOrder(shelves: Shelf[], order: string[]): Shelf[] {
  const rank = new Map(order.map((title, i) => [title, i]));
  return shelves
    .map((shelf, i) => ({ shelf, i, rank: rank.get(shelf.title) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.shelf);
}

function HomePage() {
  const qc = useQueryClient();
  const {
    data,
    isLoading,
    error,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["home", "v2"],
    queryFn: ({ pageParam }) => fetchHomeFeedPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const shelves = useMemo(
    () => data?.pages.flatMap((p) => p.shelves) ?? [],
    [data?.pages],
  );

  const order = useHomeSectionsStore((s) => s.order);
  const customized = useHomeSectionsStore((s) => s.customized);
  const registerSections = useHomeSectionsStore((s) => s.register);

  // Learn any titles we haven't seen before (new or rotated-in
  // sections) so they show up in the settings reorder list, whether or
  // not the user has customized the order yet. A no-op set() when
  // every title's already known, so this costs nothing on the common
  // path.
  useEffect(() => {
    if (shelves.length === 0) return;
    registerSections(shelves.map((s) => s.title));
  }, [shelves, registerSections]);

  const displayShelves = useMemo(
    () => (customized ? sortShelvesByOrder(shelves, order) : shelves),
    [shelves, order, customized],
  );

  // Reset back to a fresh first page. A plain refetch replays every
  // loaded page's cursor, including continuation tokens rehydrated from
  // the persisted cache — once YouTube rejects one (HTTP 400 on a stale
  // token) it rejects it forever, so refetch/Retry could never recover.
  // Resetting drops the dead cursors and reloads page 1 for new ones.
  const resetFeed = () =>
    void qc.resetQueries({ queryKey: ["home", "v2"] });

  // Manual refresh: pull a fresh home feed (recommendations rotate on
  // YT's side) and jump back to the top so the user lands on the new
  // top shelves. Reset (not refetch) so stale persisted cursors are
  // dropped rather than replayed — see resetFeed above.
  const refreshing = isFetching && !isFetchingNextPage;
  const handleRefresh = () => {
    if (refreshing) return;
    document
      .querySelector<HTMLElement>("main.app-scroll")
      ?.scrollTo({ top: 0, behavior: "smooth" });
    resetFeed();
  };

  // With a custom order applied, fetch every page up front instead of
  // waiting on scroll — a section the user ranked first might live on
  // a later API page, and we want it to actually render first rather
  // than popping to the top once its page finally loads. `error` stops
  // the chain after a failed continuation, matching the sentinel's
  // own guard below.
  useEffect(() => {
    if (!customized || !hasNextPage || isFetchingNextPage || error) return;
    fetchNextPage();
  }, [customized, hasNextPage, isFetchingNextPage, error, fetchNextPage]);

  // True while a custom order still has unfetched pages left to apply —
  // the shelf list stays hidden behind the skeleton during this phase
  // so sections don't visibly reflow into their final order.
  const eagerLoadPending = customized && !!hasNextPage && !error;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    // `error` guard: stop auto-loading after a failed continuation so the
    // still-visible sentinel doesn't re-fire fetchNextPage in a loop.
    // Skipped entirely once a custom order is active — the effect above
    // already drives page-fetching in that mode.
    if (!node || customized || !hasNextPage || isFetchingNextPage || error)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [customized, hasNextPage, isFetchingNextPage, fetchNextPage, error]);

  return (
    <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Home</h1>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh home feed"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
        >
          <IconRefresh
            className={cn("size-3.5", refreshing && "animate-spin")}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && shelves.length === 0 ? (
        <ErrorCard
          title="Couldn't load home feed"
          message={(error as Error).message}
          onRetry={resetFeed}
        />
      ) : null}

      {isLoading || eagerLoadPending ? <HomeSkeleton /> : null}

      {!isLoading && !eagerLoadPending
        ? displayShelves.map((shelf) => (
            <ShelfCarousel key={shelf.id} shelf={shelf} />
          ))
        : null}

      {error && shelves.length > 0 ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <IconAlertCircle className="size-4 shrink-0 text-destructive" />
          <span>Couldn't load more — {(error as Error).message}</span>
          <button
            type="button"
            onClick={resetFeed}
            className="text-brand hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {hasNextPage && !customized ? (
        <div
          ref={sentinelRef}
          className="flex h-16 items-center justify-center text-muted-foreground"
        >
          {isFetchingNextPage ? (
            <IconLoader2 className="size-5 animate-spin" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {Array.from({ length: 3 }).map((_, i) => (
        <ShelfSectionSkeleton key={i} />
      ))}
    </div>
  );
}
