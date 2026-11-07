import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchAlbum } from "@/lib/innertube/album";
import { EntityHeader } from "@/components/shared/entity-header";
import { AlbumMoreMenu } from "@/components/shared/album-menu";
import { TrackList } from "@/components/shared/track-list";
import { JumpToCurrentButton } from "@/components/shared/jump-to-current-button";
import { EntityHeaderSkeleton } from "@/components/layout/entity-page-header";
import { TrackRowSkeletonList } from "@/components/shared/skeletons";
import { usePlaybackStore } from "@/lib/store/playback";
import { ErrorCard } from "@/components/shared/error-card";

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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["album", id],
    queryFn: () => fetchAlbum(id),
  });

  if (error) {
    return (
      <ErrorCard
        title="Couldn't load album"
        message={(error as Error).message}
        onRetry={() => refetch()}
      />
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
        enlargeCover
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
        actions={<AlbumMoreMenu album={data} />}
      />

      <JumpToCurrentButton tracks={tracksWithCover} />

      {/* hideAlbum: every row's `album` now backfills to this same
          album (see tracksWithCover above) — showing an Album column
          here would just repeat the page's own title on every row. */}
      <TrackList tracks={tracksWithCover} hideThumbnails hideAlbum />
    </div>
  );
}

// The header skeleton shares EntityPageHeader's geometry and the rows
// share TrackList's grid, so nothing moves when the data lands.
function AlbumSkeleton() {
  return (
    <>
      <EntityHeaderSkeleton
        subtitle
        metadata
        actions={["w-[77px]", "w-24", "w-9"]}
      />
      <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
        <TrackRowSkeletonList count={8} hideThumbnails hideAlbum />
      </div>
    </>
  );
}
