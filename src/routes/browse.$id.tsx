import { useEffect, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { fetchBrowsePage } from "@/lib/innertube/browse";
import { EntityHeader } from "@/components/shared/entity-header";
import { ShelfCard } from "@/components/shared/shelf-card";
import { TrackList } from "@/components/shared/track-list";
import { Skeleton } from "@/components/ui/skeleton";
import type { Shelf } from "@/lib/innertube/types";

/**
 * Generic full-list browse page — the target of a shelf "More" link on
 * the artist page (discography grids, "Playlists by <artist>", etc.).
 * `p` is the opaque InnerTube params token paired with the browseId;
 * `t` is the display title carried over from the shelf the user clicked.
 */
export const Route = createFileRoute("/browse/$id")({
  component: BrowsePageView,
  validateSearch: (search: Record<string, unknown>) => ({
    p: typeof search.p === "string" ? search.p : "",
    t: typeof search.t === "string" ? search.t : "",
    a: typeof search.a === "string" ? search.a : "",
    aid: typeof search.aid === "string" ? search.aid : "",
    img: typeof search.img === "string" ? search.img : "",
    view: typeof search.view === "string" ? search.view : "",
  }),
});

function BrowsePageView() {
  const { id } = Route.useParams();
  const { p, t, a, aid, img, view } = Route.useSearch();
  const isTopSongs = view === "top-songs";

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["browse", id, p],
    queryFn: ({ pageParam }) => fetchBrowsePage(id, p, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const shelves = data?.pages.flatMap((page) => page.shelves) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, error]);

  return (
    <div className="flex flex-col gap-6 px-6 pb-6 pt-3">
      {aid ? (
        <EntityHeader
          title={t || (isTopSongs ? "Top songs" : "Browse")}
          subtitle={
            a ? (
              <Link
                to="/artist/$id"
                params={{ id: aid }}
                className="hover:text-foreground hover:underline"
              >
                {a}
              </Link>
            ) : undefined
          }
          thumbnails={img ? [{ url: img, width: 512, height: 512 }] : []}
          round
          keepSubtitleInCompact
        />
      ) : (
        <h1 className="text-3xl font-bold tracking-tight">{t || "Browse"}</h1>
      )}

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertCircleIcon className="size-5 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <span className="font-medium">Couldn't load this list</span>
            <span className="text-muted-foreground">
              {(error as Error).message}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-1 w-fit text-brand hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? <BrowseSkeleton /> : null}

      {shelves.map((shelf) => (
        <BrowseShelf
          key={shelf.id}
          shelf={shelf}
          showTitle={shelves.length > 1}
          showPlays={isTopSongs}
        />
      ))}

      {hasNextPage ? (
        <div
          ref={sentinelRef}
          className="flex h-16 items-center justify-center text-muted-foreground"
        >
          {isFetchingNextPage ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BrowseShelf({
  shelf,
  showTitle,
  showPlays,
}: {
  shelf: Shelf;
  showTitle: boolean;
  showPlays: boolean;
}) {
  // Synthetic "Section N" titles carry no information — hide them.
  const title =
    showTitle && !/^Section \d+$/.test(shelf.title) ? shelf.title : null;

  if (shelf.display === "list") {
    const tracks = shelf.items.filter((i) => i.kind === "song");
    if (tracks.length === 0) return null;
    return (
      <section className="flex flex-col gap-3">
        {title ? (
          <h2 className="truncate px-1 text-xl font-semibold tracking-tight">
            {title}
          </h2>
        ) : null}
        <TrackList tracks={tracks} showPlays={showPlays} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {title ? (
        <h2 className="truncate px-1 text-xl font-semibold tracking-tight">
          {title}
        </h2>
      ) : null}
      <div className="grid w-full gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] [&>*]:max-w-[16rem]">
        {shelf.items.map((item) => (
          <ShelfCard key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function BrowseSkeleton() {
  return (
    <div className="grid w-full gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
