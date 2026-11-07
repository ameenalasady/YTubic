import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowsShuffle,
  IconCheck,
  IconChevronRight,
  IconLoader2,
  IconRadio,
  IconShare3,
  IconUserPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { fetchArtist, setArtistSubscribed } from "@/lib/innertube/artist";
import { fetchWatchQueue } from "@/lib/innertube/radio";
import { fetchVariedRadio } from "@/lib/innertube/radio-variety";
import { EntityHeader } from "@/components/shared/entity-header";
import { ExpandableText } from "@/components/shared/expandable-text";
import { ShelfCarousel } from "@/components/shared/shelf-carousel";
import { TrackList } from "@/components/shared/track-list";
import { pickHighResThumbnail } from "@/components/shared/thumbnail";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShelfSectionSkeleton,
  TrackRowSkeletonList,
} from "@/components/shared/skeletons";
import { EntityHeaderSkeleton } from "@/components/layout/entity-page-header";
import { Button } from "@/components/ui/button";
import { copyLink } from "@/lib/clipboard";
import { universalShareUrl } from "@/lib/deep-link";
import { Separator } from "@/components/ui/separator";
import { usePlaybackStore } from "@/lib/store/playback";
import type {
  ArtistPage,
  Shelf,
  ShelfMore,
  WatchTarget,
} from "@/lib/innertube/types";
import { ErrorCard } from "@/components/shared/error-card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/artist/$id")({
  component: ArtistPageView,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["artist", params.id],
      queryFn: () => fetchArtist(params.id),
    }),
});

function ArtistPageView() {
  const { id } = Route.useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["artist", id],
    queryFn: () => fetchArtist(id),
  });

  if (error) {
    return (
      <ErrorCard
        title="Couldn't load artist"
        message={(error as Error).message}
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading || !data) return <ArtistSkeleton />;

  // Official web shows the monthly-audience stat in the header; the raw
  // subscriber count lives on the Subscribe button instead.
  const subtitle =
    data.monthlyAudience ??
    (data.subscribers ? `${data.subscribers} subscribers` : undefined);

  return (
    <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
      <EntityHeader
        title={data.name}
        subtitle={
          <>
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
              Artist
            </span>
            {subtitle ? (
              <>
                <span aria-hidden="true" className="mx-2 text-foreground/25">
                  •
                </span>
                {subtitle}
              </>
            ) : null}
          </>
        }
        thumbnails={data.thumbnails}
        actions={<ArtistActions artist={data} />}
      />

      {data.shelves.map((shelf) => {
        // Only pass an action when the shelf actually has a More target —
        // a truthy-but-empty element would hide the shelf's subtitle slot.
        const more = shelf.more ? (
          <ShelfMoreLink shelf={shelf} artist={data} />
        ) : undefined;
        const useTrackList =
          shelf.display === "list" ||
          shelf.title.trim().toLowerCase() === "from your library";
        return useTrackList ? (
          <ListShelf key={shelf.id} shelf={shelf} action={more} />
        ) : (
          <ShelfCarousel key={shelf.id} shelf={shelf} action={more} />
        );
      })}

      <AboutSection key={data.id} artist={data} />
    </div>
  );
}

/**
 * "About" panel at the bottom of the page — the full bio with a
 * Read-more toggle plus the audience stats, mirroring the official
 * web client's About card.
 */
function AboutSection({ artist }: { artist: ArtistPage }) {
  if (!artist.description?.trim()) return null;

  const stats: { value: string; label: string }[] = [];
  if (artist.monthlyAudience) {
    // "241M monthly audience" → value "241M", label "Monthly audience".
    const [value, ...rest] = artist.monthlyAudience.split(" ");
    const label = rest.join(" ");
    stats.push({
      value,
      label: label
        ? label.charAt(0).toUpperCase() + label.slice(1)
        : "Monthly audience",
    });
  }
  if (artist.subscribers) {
    stats.push({ value: artist.subscribers, label: "Subscribers" });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-xl font-semibold tracking-tight">About</h2>
      <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-surface p-4">
        {artist.description ? (
          <ExpandableText
            text={artist.description}
            lines={5}
            className="leading-relaxed"
          />
        ) : null}
        {artist.description && stats.length > 0 ? <Separator /> : null}
        {stats.length > 0 ? (
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span className="text-lg font-bold leading-tight">
                  {s.value}
                </span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Header action row: Shuffle (primary), Mix, Subscribe, Share — the same
 * four controls the official web header offers.
 */
// The header's action row sits beside the cover at a fixed position and
// can't wrap. Below the width the full row needs (cover column + Shuffle,
// Mix, Subscribe with its count, Share), Mix and Subscribe drop their text
// and become square icon buttons like Share.
const NARROW_ICON_ONLY = "@max-[615px]/hdr:w-9 @max-[615px]/hdr:px-0!";
const NARROW_HIDDEN = "@max-[615px]/hdr:hidden";

function ArtistActions({ artist }: { artist: ArtistPage }) {
  const [pending, setPending] = useState<"shuffle" | "mix" | null>(null);

  const play = async (kind: "shuffle" | "mix", target?: WatchTarget) => {
    if (!target || pending) return;
    setPending(kind);
    try {
      const tracks = target.playlistId
        ? await fetchWatchQueue(target.playlistId, target.videoId)
        : target.videoId
          ? await fetchVariedRadio(target.videoId, {
              limit: 40,
              includeSeed: true,
            })
          : [];
      if (tracks.length) {
        usePlaybackStore.getState().playShelfItems(tracks, 0);
      } else {
        toast.error("Couldn't start playback - no tracks returned.");
      }
    } catch (e) {
      toast.error(`Couldn't start playback: ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      {artist.shuffle ? (
        <Button
          onClick={() => play("shuffle", artist.shuffle)}
          disabled={pending !== null}
        >
          {pending === "shuffle" ? (
            <IconLoader2 className="animate-spin" />
          ) : (
            <IconArrowsShuffle />
          )}
          Shuffle
        </Button>
      ) : null}
      {artist.mix ? (
        <Button
          variant="secondary"
          onClick={() => play("mix", artist.mix)}
          disabled={pending !== null}
          aria-label="Mix"
          className={NARROW_ICON_ONLY}
        >
          {pending === "mix" ? (
            <IconLoader2 className="animate-spin" />
          ) : (
            <IconRadio />
          )}
          <span className={NARROW_HIDDEN}>Mix</span>
        </Button>
      ) : null}
      {artist.channelId ? (
        <SubscribeButton
          channelId={artist.channelId}
          initialSubscribed={artist.subscribed ?? false}
          count={artist.subscribers}
        />
      ) : null}
      {/* One link for everyone: the share page opens the artist in YTubic
          when it's installed and falls back to YouTube Music when it isn't. */}
      <Button
        variant="outline"
        size="icon"
        aria-label="Share"
        onClick={() =>
          void copyLink(
            universalShareUrl(
              "artist",
              artist.id,
              artist.name,
              pickHighResThumbnail(artist.thumbnails) ?? undefined,
            ),
          )
        }
      >
        <IconShare3 />
      </Button>
    </>
  );
}

function SubscribeButton({
  channelId,
  initialSubscribed,
  count,
}: {
  channelId: string;
  initialSubscribed: boolean;
  count?: string;
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [pending, setPending] = useState(false);

  // Re-sync when the user navigates between artists (the component
  // instance is reused across routes with different data).
  useEffect(() => {
    setSubscribed(initialSubscribed);
  }, [channelId, initialSubscribed]);

  const toggle = async () => {
    if (pending) return;
    const next = !subscribed;
    setSubscribed(next);
    setPending(true);
    try {
      await setArtistSubscribed(channelId, next);
    } catch {
      setSubscribed(!next);
      toast.error(
        next
          ? "Couldn't subscribe - are you signed in?"
          : "Couldn't unsubscribe - are you signed in?",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant={subscribed ? "ghost" : "outline"}
      className={cn(
        NARROW_ICON_ONLY,
        subscribed &&
          "bg-foreground/[0.12] text-foreground shadow-none hover:bg-foreground/[0.18]",
      )}
      onClick={toggle}
      disabled={pending}
      aria-label={subscribed ? "Subscribed" : "Subscribe"}
    >
      {subscribed ? <IconCheck /> : <IconUserPlus />}
      <span className={NARROW_HIDDEN}>
        {subscribed ? "Subscribed" : "Subscribe"}
      </span>
      {count ? (
        <span
          className={cn(
            NARROW_HIDDEN,
            subscribed
              ? "font-normal text-foreground/60"
              : "font-normal text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * "More" link for a shelf header. Routes by the endpoint's pageType:
 * playlists and albums go to their dedicated pages, everything else
 * (discography grids, "Playlists by <artist>") goes to the generic
 * /browse page carrying the opaque params token.
 */
function ShelfMoreLink({
  shelf,
  artist,
}: {
  shelf: Shelf;
  artist: ArtistPage;
}) {
  const more = shelf.more;
  if (!more) return null;

  const cls =
    "inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
  const label = (
    <>
      More
      <IconChevronRight className="size-4" />
    </>
  );

  const target = moreTarget(more);
  if (!target) return null;

  if (target.kind === "playlist") {
    const isTopSongs = shelf.display === "list";
    return (
      <Link
        to="/playlist/$id"
        params={{ id: target.id }}
        search={
          isTopSongs
            ? {
                view: "top-songs",
                t: shelf.title,
                a: artist.name,
                aid: artist.id,
                img: pickHighResThumbnail(artist.thumbnails) ?? "",
              }
            : {
                from: "artist",
                t: shelf.title,
                a: artist.name,
                aid: artist.id,
                img: pickHighResThumbnail(artist.thumbnails) ?? "",
              }
        }
        className={cls}
      >
        {label}
      </Link>
    );
  }
  if (target.kind === "album") {
    return (
      <Link to="/album/$id" params={{ id: target.id }} className={cls}>
        {label}
      </Link>
    );
  }
  if (target.kind === "artist") {
    return (
      <Link to="/artist/$id" params={{ id: target.id }} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <Link
      to="/browse/$id"
      params={{ id: target.id }}
      search={{
        p: more.params ?? "",
        t: shelf.title,
        a: artist.name,
        aid: artist.id,
        img: pickHighResThumbnail(artist.thumbnails) ?? "",
        view: shelf.display === "list" ? "top-songs" : "",
      }}
      className={cls}
    >
      {label}
    </Link>
  );
}

function moreTarget(
  more: ShelfMore,
): { kind: "playlist" | "album" | "artist" | "browse"; id: string } | null {
  const pageType = more.pageType ?? "";
  if (pageType.includes("PLAYLIST")) {
    return { kind: "playlist", id: more.browseId };
  }
  if (pageType.includes("ALBUM")) {
    return { kind: "album", id: more.browseId };
  }
  // A bare artist link without params would just reload this page.
  if (pageType.includes("ARTIST") && !pageType.includes("DISCOGRAPHY")) {
    if (!more.params) return { kind: "artist", id: more.browseId };
    return { kind: "browse", id: more.browseId };
  }
  return { kind: "browse", id: more.browseId };
}

function ListShelf({
  shelf,
  action,
}: {
  shelf: Shelf;
  action?: React.ReactNode;
}) {
  const tracks = shelf.items.filter((i) => i.kind === "song");
  if (tracks.length === 0) return null;
  const normalizedTitle = shelf.title.trim().toLowerCase();
  const visibleTracks =
    normalizedTitle === "from your library" ? tracks.slice(0, 5) : tracks;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="truncate text-xl font-semibold tracking-tight">
          {shelf.title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {/* Top Songs carries play counts instead of duration. Other shelves
          rendered as lists (such as From your library) keep Duration. */}
      <TrackList
        tracks={visibleTracks}
        showPlays={normalizedTitle === "top songs"}
      />
    </section>
  );
}

function ArtistSkeleton() {
  return (
    <>
      {/* Shuffle, Mix, Subscribe, Share; Mix and Subscribe shrink to icon
          buttons in a narrow header, as the real ones do. */}
      <EntityHeaderSkeleton
        subtitle
        actions={[
          "w-24",
          cn("w-[73px]", NARROW_ICON_ONLY),
          cn("w-[156px]", NARROW_ICON_ONLY),
          "w-9",
        ]}
      />
      <div className="flex flex-col gap-8 px-6 pb-6 pt-3">
        <section className="flex flex-col gap-3">
          <Skeleton className="ml-1 h-7 w-32" />
          <TrackRowSkeletonList count={5} showPlays />
        </section>
        <ShelfSectionSkeleton titleWidth="w-24" />
      </div>
    </>
  );
}
