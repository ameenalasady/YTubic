import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { fetchHomeFeedPage } from "@/lib/innertube/home";
import { ShelfCarousel } from "@/components/shared/shelf-carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const {
    data,
    isLoading,
    error,
    refetch,
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

  // Manual refresh: pull a fresh home feed (recommendations rotate on
  // YT's side) and jump back to the top so the user lands on the new
  // top shelves. `refetch` re-runs every loaded page, so the whole feed
  // updates in place rather than just page one.
  const refreshing = isFetching && !isFetchingNextPage;
  const handleRefresh = () => {
    if (refreshing) return;
    document
      .querySelector<HTMLElement>("main.app-scroll")
      ?.scrollTo({ top: 0, behavior: "smooth" });
    void refetch();
  };

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    // `error` guard: stop auto-loading after a failed continuation so the
    // still-visible sentinel doesn't re-fire fetchNextPage in a loop.
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
          <RefreshCwIcon
            className={cn("size-3.5", refreshing && "animate-spin")}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertCircleIcon className="size-5 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <span className="font-medium">Couldn't load home feed</span>
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

      {isLoading ? <HomeSkeleton /> : null}

      {shelves.map((shelf) => (
        <ShelfCarousel key={shelf.id} shelf={shelf} />
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

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {Array.from({ length: 3 }).map((_, shelfIdx) => (
        <section key={shelfIdx} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-64" />
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-44 shrink-0 md:w-48 lg:w-52">
                <div className="flex flex-col gap-2 p-2">
                  <Skeleton className="aspect-square w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
