import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import { fetchAlbum } from "@/lib/innertube/album";
import { EntityHeader } from "@/components/shared/entity-header";
import { TrackList } from "@/components/shared/track-list";
import { JumpToCurrentButton } from "@/components/shared/jump-to-current-button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackRowSkeletonList } from "@/components/shared/skeletons";
import { usePlaybackStore } from "@/lib/store/playback";

export const Route = createFileRoute("/album/$id")({
  component: AlbumPageView,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["album", params.id],
      queryFn: () => fetchAlbum(params.id),
    }),
});

function AlbumPageView() {
  const { id } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["album", id],
    queryFn: () => fetchAlbum(id),
  });

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <AlertCircleIcon className="size-5 shrink-0 text-destructive" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">Couldn't load album</span>
          <span className="text-muted-foreground">
            {(error as Error).message}
          </span>
        </div>
      </div>
    );
  }

  if (isLoading || !data) return <AlbumSkeleton />;

  const subtitleParts = [
    ...data.artists.map((a) =>
      a.id ? (
        <Link
          key={a.id}
          to="/artist/$id"
          params={{ id: a.id }}
          className="hover:text-foreground hover:underline"
        >
          {a.name}
        </Link>
      ) : (
        <span key={a.name}>{a.name}</span>
      ),
    ),
  ];

  const metadataParts = [
    data.releaseDate ?? data.year,
    data.trackCount ? `${data.trackCount} songs` : undefined,
    data.duration,
  ].filter(Boolean) as string[];

  // Album-page rows come back from YT without per-row thumbnail,
  // artist, or album info — that data isn't repeated on every row of
  // an album's own tracklist the way it is in search results or a
  // playlist, since it's implied by the page itself. Backfill it from
  // the album level before queuing/display: without the cover, the
  // player card and background cover render empty; without
  // artists/album/albumId, the player card's artist/album links (and
  // the track list's own artist column) have nothing to show.
  const tracksWithCover = data.tracks.map((t) => ({
    ...t,
    thumbnails: t.thumbnails.length > 0 ? t.thumbnails : data.thumbnails,
    artists: t.artists?.length ? t.artists : data.artists,
    album: t.album ?? data.title,
    albumId: t.albumId ?? data.id,
  }));

  return (
    <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
      <EntityHeader
        title={data.title}
        subtitle={
          subtitleParts.length > 0 ? (
            <>
              {subtitleParts.map((node, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {node}
                  {i < subtitleParts.length - 1 ? "," : ""}
                </span>
              ))}
            </>
          ) : undefined
        }
        thumbnails={data.thumbnails}
        metadata={metadataParts.join(" • ")}
        onPlay={() => {
          if (tracksWithCover.length > 0) {
            usePlaybackStore.getState().playShelfItems(tracksWithCover, 0);
            usePlaybackStore.getState().setShuffle(false);
          }
        }}
        onShuffle={() => {
          if (tracksWithCover.length > 0) {
            const start = Math.floor(Math.random() * tracksWithCover.length);
            usePlaybackStore
              .getState()
              .playShelfItems(tracksWithCover, start);
            usePlaybackStore.getState().setShuffle(true);
          }
        }}
      />

      <JumpToCurrentButton tracks={tracksWithCover} />

      {/* hideAlbum: every row's `album` now backfills to this same
          album (see tracksWithCover above) — showing an Album column
          here would just repeat the page's own title on every row. */}
      <TrackList tracks={tracksWithCover} hideThumbnails hideAlbum />
    </div>
  );
}

// Mirrors the real hero (EntityPageHeader's HeroLayout) and TrackList
// row geometry so there's no visible pop when data replaces this:
// `size-40` cover (never scales up, unlike the old `md:w-56`), `gap-6`
// row layout, and title/subtitle/metadata bars sized to their real
// line-heights (text-4xl → h-10, text-sm subtitle → h-5, text-xs
// metadata → h-4). Rows use the shared zero-gap TrackRowSkeletonList
// instead of a `gap-8`-spaced stack of bars, matching how the
// virtualizer actually packs 56px rows with no space between them.
function AlbumSkeleton() {
  return (
    <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
      <div className="flex flex-row items-end gap-6">
        <Skeleton className="size-40 shrink-0 border border-hairline shadow-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <TrackRowSkeletonList count={8} />
    </div>
  );
}
