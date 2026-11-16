import { useEffect, useMemo, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { IconLoader2 } from "@tabler/icons-react";
import { fetchBrowsePage } from "@/lib/innertube/browse";
import { EntityHeader } from "@/components/shared/entity-header";
import { ShelfCard } from "@/components/shared/shelf-card";
import { TrackList } from "@/components/shared/track-list";
import { Skeleton } from "@/components/ui/skeleton";
import type { Shelf } from "@/lib/innertube/types";
import { ErrorCard } from "@/components/shared/error-card";
import { SortMenu } from "@/components/shared/sort-menu";
import { CardGrid, ViewMenu } from "@/components/shared/view-menu";
import { sortTracks } from "@/lib/sort-tracks";
import {
  usePlaylistSortStore,
  type PlaylistSortMode,
} from "@/lib/store/playlist-sort";
import {
  useVideosViewStore,
  type CardSize,
  type ViewLayout,
} from "@/lib/store/videos-view";

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

  const shelves = useMemo(
    () => data?.pages.flatMap((page) => page.shelves) ?? [],
    [data?.pages],
  );

  // A list of songs / videos (an artist's "Videos") can be sorted and shown
  // as a list or as cards. Albums, playlists and the like keep their grid.
  const tracksOnly =
    !isTopSongs &&
    shelves.length > 0 &&
    shelves.every(
      (sh) =>
        sh.items.length > 0 &&
        sh.items.every((i) => i.kind === "song" || i.kind === "video"),
    );
  const sortKey = `browse:${id}:${p}`;
  const sortMode = usePlaylistSortStore(
    (s) => s.modes[sortKey] ?? ("default" as PlaylistSortMode),
  );
  const setSortMode = usePlaylistSortStore((s) => s.setMode);
  const savedLayout = useVideosViewStore((s) => s.layout);
  const cardSize = useVideosViewStore((s) => s.size);
  const setLayout = useVideosViewStore((s) => s.setLayout);
  const setCardSize = useVideosViewStore((s) => s.setSize);
  // Until the user picks one, a page keeps the look it always had.
  const layout: ViewLayout =
    savedLayout ??
    (shelves.some((sh) => sh.display === "list") ? "list" : "cards");

  // A sort has to see the whole list, so load the remaining pages when one
  // is chosen. Spaced out so a very long list does not hammer the API.
  useEffect(() => {
    if (!tracksOnly || sortMode === "default") return;
    if (!hasNextPage || isFetchingNextPage || error) return;
    const timer = setTimeout(() => fetchNextPage(), 250);
    return () => clearTimeout(timer);
  }, [
    tracksOnly,
    sortMode,
    hasNextPage,
    isFetchingNextPage,
    error,
    fetchNextPage,
  ]);

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

      {tracksOnly ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SortMenu
              mode={sortMode}
              onChange={(m) => setSortMode(sortKey, m)}
              isLikedSongs={false}
            />
            <ViewMenu
              layout={layout}
              size={cardSize}
              onLayout={setLayout}
              onSize={(size) => {
                setCardSize(size);
                setLayout("cards");
              }}
            />
          </div>
          {sortMode !== "default" && hasNextPage ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconLoader2 className="size-3 animate-spin" />
              Loading the full list for sorting…
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <ErrorCard
          title="Couldn't load this list"
          message={(error as Error).message}
          onRetry={() => refetch()}
        />
      ) : null}

      {isLoading ? <BrowseSkeleton /> : null}

      {shelves.map((shelf) => (
        <BrowseShelf
          key={shelf.id}
          shelf={shelf}
          showTitle={shelves.length > 1}
          showPlays={isTopSongs}
          tracksOnly={tracksOnly}
          layout={layout}
          cardSize={cardSize}
          sortMode={sortMode}
        />
      ))}

      {hasNextPage ? (
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

function BrowseShelf({
  shelf,
  showTitle,
  showPlays,
  tracksOnly,
  layout,
  cardSize,
  sortMode,
}: {
  shelf: Shelf;
  showTitle: boolean;
  showPlays: boolean;
  /** The whole page is songs / videos: sortable, list or cards. */
  tracksOnly: boolean;
  layout: ViewLayout;
  cardSize: CardSize;
  sortMode: PlaylistSortMode;
}) {
  // Synthetic "Section N" titles carry no information — hide them.
  const title =
    showTitle && !/^Section \d+$/.test(shelf.title) ? shelf.title : null;
  const items = useMemo(
    () => (tracksOnly ? sortTracks(shelf.items, sortMode) : shelf.items),
    [tracksOnly, shelf.items, sortMode],
  );

  if (tracksOnly ? layout === "list" : shelf.display === "list") {
    const tracks = tracksOnly
      ? items
      : shelf.items.filter((i) => i.kind === "song");
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
      {tracksOnly ? (
        <CardGrid size={cardSize}>
          {items.map((item) => (
            <ShelfCard key={`${item.kind}:${item.id}`} item={item} wide />
          ))}
        </CardGrid>
      ) : (
        <div className="grid w-full gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] [&>*]:max-w-[16rem]">
          {shelf.items.map((item) => (
            <ShelfCard key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function BrowseSkeleton() {
  return (
    <div className="grid w-full gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] [&>*]:max-w-[16rem]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg p-2">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
