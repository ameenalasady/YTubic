import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import {
  IconArrowsShuffle2,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
  IconTransitionRightFilled,
  IconUserFilled,
} from "@tabler/icons-react";
import {
  IconPlaylistAddFilled,
  IconRadioFilled,
  IconShare3Filled,
} from "@/components/shared/filled-icons";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  ctxPrimitives,
  dropPrimitives,
} from "@/components/shared/track-context-menu";
import { pickHighResThumbnail } from "@/components/shared/thumbnail";
import { fetchAlbum } from "@/lib/innertube/album";
import { copyLink } from "@/lib/clipboard";
import { universalShareUrl } from "@/lib/deep-link";
import { fetchVariedRadio } from "@/lib/innertube/radio-variety";
import { usePlaybackStore } from "@/lib/store/playback";
import { usePlaybackSettings } from "@/lib/store/playback-settings";
import { armFadeInto } from "@/lib/fade-request";
import type { AlbumPage, ShelfItem } from "@/lib/innertube/types";

// Album rows carry no per-track thumbnail (the cover lives at the album
// level), so backfill it before queuing — otherwise the player card and
// background cover render empty. Same treatment the album page applies:
// cover plus artists/album/albumId so the player card's links have
// something to show.
function withCover(album: AlbumPage): ShelfItem[] {
  return album.tracks.map((t) => ({
    ...t,
    thumbnails: t.thumbnails.length > 0 ? t.thumbnails : album.thumbnails,
    artists: t.artists?.length ? t.artists : album.artists,
    album: t.album ?? album.title,
    albumId: (t as ShelfItem).albumId ?? album.id,
  }));
}

/**
 * Shared state + handlers for both the right-click menu on an album card
 * and the ⋯ dropdown on the album page — same split as
 * `useTrackMenuController`, only the surrounding primitives differ.
 *
 * A card only knows the album's browse id, so every action resolves the
 * track list on demand. It goes through the *same* query key the album
 * page uses, so using this menu warms that page and vice versa. Callers
 * that already hold the page (the album route) pass it in and skip the
 * fetch entirely.
 */
export function useAlbumMenuController(albumId: string, album?: AlbumPage) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const resolve = async (): Promise<AlbumPage | null> => {
    if (album) return album;
    try {
      return await qc.fetchQuery({
        queryKey: ["album", albumId],
        queryFn: () => fetchAlbum(albumId),
        staleTime: 5 * 60_000,
      });
    } catch (e) {
      toast.error(`Couldn't load album: ${String(e)}`);
      return null;
    }
  };

  const play = async (shuffle: boolean, crossfade = false) => {
    const a = await resolve();
    if (!a) return;
    const items = withCover(a);
    if (items.length === 0) return;
    const store = usePlaybackStore.getState();
    // Armed only now, right before the commit: the album may have had to
    // be fetched first, and the request expires within moments.
    if (crossfade) armFadeInto();
    store.playShelfItems(
      items,
      shuffle ? Math.floor(Math.random() * items.length) : 0,
    );
    store.setShuffle(shuffle);
  };

  const playNext = async () => {
    const a = await resolve();
    if (!a) return;
    const items = withCover(a);
    if (items.length === 0) return;
    // enqueueNext always inserts directly after the current track, so
    // walking the album backwards leaves it in album order.
    for (const t of [...items].reverse()) {
      usePlaybackStore.getState().enqueueNext(t);
    }
    toast.success(`Playing next: ${a.title}`);
  };

  const addToQueue = async () => {
    const a = await resolve();
    if (!a) return;
    const items = withCover(a);
    if (items.length === 0) return;
    usePlaybackStore.getState().appendToQueue(items);
    toast.success(`Added to queue: ${a.title}`);
  };

  const startRadio = async () => {
    const a = await resolve();
    if (!a) return;
    const items = withCover(a);
    const seed = items[0];
    if (!seed) return;
    try {
      const radio = await fetchVariedRadio(seed.id, { limit: 40 });
      usePlaybackStore.getState().playShelfItems([seed, ...radio], 0);
    } catch {
      void play(false);
    }
  };

  const goToArtist = async () => {
    const a = await resolve();
    if (!a) return;
    const artist = a.artists.find((x) => x.id);
    if (!artist?.id) {
      toast.error("No artist page for this album");
      return;
    }
    navigate({ to: "/artist/$id", params: { id: artist.id } });
  };

  // The title travels in the link so the share page has something to
  // show before (or without) any metadata fetch of its own.
  const share = async () => {
    const a = await resolve();
    await copyLink(
      universalShareUrl(
        "album",
        albumId,
        a?.title,
        a ? (pickHighResThumbnail(a.thumbnails) ?? undefined) : undefined,
      ),
    );
  };

  return { play, playNext, addToQueue, startRadio, goToArtist, share };
}

export function AlbumMenuItems({
  controller,
  primitives,
}: {
  controller: ReturnType<typeof useAlbumMenuController>;
  primitives: typeof ctxPrimitives;
}) {
  const { Item, Separator } = primitives;
  const { play, playNext, addToQueue, startRadio, goToArtist, share } =
    controller;
  const crossfadeSec = usePlaybackSettings((s) => s.crossfadeSec);
  const somethingPlaying = usePlaybackStore((s) => s.playing);

  return (
    <>
      <Item onSelect={() => void play(false)}>
        <IconPlayerPlayFilled />
        Play
      </Item>
      {crossfadeSec > 0 && somethingPlaying ? (
        <Item onSelect={() => void play(false, true)}>
          <IconTransitionRightFilled />
          Play with crossfade
        </Item>
      ) : null}
      <Item onSelect={() => void play(true)}>
        <IconArrowsShuffle2 />
        Shuffle play
      </Item>
      <Item onSelect={() => void playNext()}>
        <IconPlayerTrackNextFilled />
        Play next
      </Item>
      <Item onSelect={() => void addToQueue()}>
        <IconPlaylistAddFilled />
        Add to queue
      </Item>
      <Item onSelect={() => void startRadio()}>
        <IconRadioFilled />
        Start radio
      </Item>

      <Separator />

      <Item onSelect={() => void goToArtist()}>
        <IconUserFilled />
        Go to artist
      </Item>

      <Separator />

      {/* One link for everyone: the share page opens the album in YTubic
          when it's installed and falls back to YouTube Music when it isn't. */}
      <Item onSelect={() => void share()}>
        <IconShare3Filled />
        Share
      </Item>
    </>
  );
}

/** Right-click menu for an album card. */
export function AlbumContextMenu({
  albumId,
  children,
}: {
  albumId: string;
  children: ReactNode;
}) {
  const controller = useAlbumMenuController(albumId);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <AlbumMenuItems controller={controller} primitives={ctxPrimitives} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** ⋯ button for the album page header. Same actions as the card menu. */
export function AlbumMoreMenu({ album }: { album: AlbumPage }) {
  const controller = useAlbumMenuController(album.id, album);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <AlbumMenuItems controller={controller} primitives={dropPrimitives} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
