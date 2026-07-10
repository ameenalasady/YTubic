import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  PinIcon,
  PinOffIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronRightIcon,
  ZapIcon,
  DumbbellIcon,
  CarIcon,
  HeartIcon,
  CloudRainIcon,
  SmileIcon,
  MoonIcon,
  TargetIcon,
  PartyPopperIcon,
  CoffeeIcon,
  UsersIcon,
  MusicIcon,
  Music2Icon,
  Music3Icon,
  Music4Icon,
  MicIcon,
  GuitarIcon,
  PianoIcon,
  SkullIcon,
  FilmIcon,
  BabyIcon,
  ChurchIcon,
  SnowflakeIcon,
  GlobeIcon,
  type LucideIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { Thumbnail } from "@/components/shared/thumbnail";
import { ArtistLinks } from "@/components/shared/artist-links";
import { TrackContextMenu } from "@/components/shared/track-context-menu";
import { usePlaybackStore } from "@/lib/store/playback";
import {
  useIsHidden,
  useIsPinned,
  usePinnedPlaylistsStore,
} from "@/lib/store/pinned-playlists";
import type { ShelfItem } from "@/lib/innertube/types";

type Props = {
  item: ShelfItem;
  className?: string;
};

// Per-category icons for Moods & Genres tiles. The InnerTube payload only
// gives us a title + tint color, so the icon is a heuristic by lowercase
// title. Fallback `Music2` for unmatched titles, `Globe` when the title
// looks like a region/language tag.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  energize: ZapIcon,
  workout: DumbbellIcon,
  commute: CarIcon,
  romance: HeartIcon,
  sad: CloudRainIcon,
  "feel good": SmileIcon,
  sleep: MoonIcon,
  focus: TargetIcon,
  party: PartyPopperIcon,
  chill: CoffeeIcon,
  family: UsersIcon,
  pop: MusicIcon,
  "hip-hop": MicIcon,
  country: GuitarIcon,
  "r&b": MicIcon,
  rock: GuitarIcon,
  soul: Music3Icon,
  latin: GuitarIcon,
  "indie & alternative": Music3Icon,
  classical: PianoIcon,
  "dance & electronic": Music4Icon,
  blues: Music3Icon,
  jazz: Music3Icon,
  metal: SkullIcon,
  reggae: Music4Icon,
  "folk & acoustic": GuitarIcon,
  "soundtracks & musicals": FilmIcon,
  "children's music": BabyIcon,
  "christian & gospel": ChurchIcon,
  holiday: SnowflakeIcon,
};

const GEO_KEYWORDS = [
  "iraqi",
  "russian",
  "turkish",
  "arabic",
  "indian",
  "spanish",
  "french",
  "german",
  "japanese",
  "korean",
  "k-pop",
  "chinese",
  "pakistani",
  "afghan",
  "egyptian",
  "lebanese",
  "tamil",
  "punjabi",
  "hindi",
  "thai",
  "vietnamese",
  "world",
];

function pickCategoryIcon(title: string): LucideIcon {
  const key = title.toLowerCase();
  if (CATEGORY_ICONS[key]) return CATEGORY_ICONS[key];
  if (GEO_KEYWORDS.some((g) => key.includes(g))) return GlobeIcon;
  return Music2Icon;
}

const CARD_CLASS =
  "group flex w-full flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none";

export function ShelfCard({ item, className }: Props) {
  const subtitle =
    item.subtitle ??
    item.artists?.map((a) => a.name).join(", ") ??
    item.album ??
    "";

  const isVideo = item.kind === "video";
  // Albums and playlists get a slightly softer corner than the
  // default rounded-md (6px) — 8px / rounded-lg reads as "physical
  // record sleeve" vs the tighter rounding on songs/videos.
  const isAlbumOrPlaylist =
    item.kind === "album" || item.kind === "playlist";
  const radiusClass = item.round
    ? "rounded-full"
    : isAlbumOrPlaylist
      ? "rounded-lg"
      : "rounded-md";

  // Only playlists are hideable, so this is always false for other kinds
  // — the badge below scopes itself to hidden playlists. Reading it here
  // (rather than in a playlist-only sub-component) keeps radiusClass and
  // the thumbnail layout in one place; the selector is cheap and only
  // ever changes on an explicit hide/show.
  const hidden = useIsHidden(item.id);

  // Songs, videos and albums carry an artist list — link each artist to
  // their page. Everything else (playlists, artist tiles) keeps the plain
  // subtitle text.
  const linkArtists =
    (item.kind === "song" ||
      item.kind === "video" ||
      item.kind === "album") &&
    !!item.artists?.length;

  // Card content. Rendered pointer-events-none so clicks fall through to
  // the primary-action overlay below — except the artist links, which
  // re-enable pointer events and sit above it (see the overlay note).
  const body = (
    <div className="pointer-events-none relative z-10 flex flex-col gap-2">
      <div
        className={cn(
          "relative w-full",
          isVideo ? "aspect-video" : "aspect-square",
        )}
      >
        <Thumbnail
          thumbnails={item.thumbnails}
          alt={item.title}
          round={item.round}
          className={cn("size-full", radiusClass)}
          targetSize={isVideo ? 480 : 256}
          highRes
        />
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 border border-hairline",
            radiusClass,
          )}
        />
        {hidden ? (
          <>
            {/* Mute the cover and stamp a crossed-out eye so a
                sidebar-hidden playlist reads as hidden at a glance. */}
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 bg-background/60",
                radiusClass,
              )}
            />
            <div
              title="Hidden from sidebar"
              className="absolute right-1.5 top-1.5 flex items-center justify-center rounded-md bg-black/65 p-1 text-white shadow-sm backdrop-blur-sm"
            >
              <EyeOffIcon className="size-4" />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            item.round && "justify-center",
          )}
        >
          <span className="truncate text-sm font-medium">{item.title}</span>
          {item.explicit ? (
            <span
              title="Explicit"
              aria-label="Explicit"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-bold leading-none text-muted-foreground"
            >
              E
            </span>
          ) : null}
        </div>
        {linkArtists ? (
          <ArtistLinks
            artists={item.artists}
            fallback={subtitle}
            className={cn(
              "truncate text-xs text-muted-foreground",
              item.round && "text-center",
            )}
            linkClassName="pointer-events-auto"
          />
        ) : subtitle ? (
          <span
            className={cn(
              "truncate text-xs text-muted-foreground",
              item.round && "text-center",
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );

  if (item.kind === "category") {
    // Horizontal pill with a colored left border (rounded with the card)
    // and a soft inner glow leaking from the left edge. browseId + params
    // get stitched back together on /moods/$id via the `p` search param.
    const tint = item.tint ?? "#666";
    const Icon = pickCategoryIcon(item.title);
    return (
      <Link
        to="/moods/$id"
        params={{ id: item.id }}
        search={{ p: item.categoryParams ?? "", t: item.title }}
        className={cn(
          "group relative flex h-14 w-full items-center gap-3 overflow-hidden rounded-lg border-l-4 bg-white/5 px-3 transition-transform hover:scale-[1.01] active:scale-[0.99]",
          className,
        )}
        style={{ borderLeftColor: tint }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 70% 130% at 0% 50%, ${tint}26, transparent 70%)`,
          }}
        />
        <Icon
          className="relative z-10 size-5 shrink-0"
          style={{ color: tint }}
        />
        <span className="relative z-10 min-w-0 flex-1 truncate text-sm font-medium text-white">
          {item.title}
        </span>
        <ChevronRightIcon className="relative z-10 size-4 shrink-0 text-white/40" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-lg border border-white opacity-10 mix-blend-difference"
        />
      </Link>
    );
  }

  // Primary-action overlay. Covering the whole card with a single
  // interactive element (rather than wrapping `body`) keeps the artist
  // links inside `body` from being nested inside another <a>/<button> —
  // which is invalid HTML and eats their clicks. `body` is
  // pointer-events-none so a click anywhere still reaches this overlay;
  // the artist links opt back in and, sitting on a higher z-index, win
  // the clicks that land on them. `cursor-pointer` here is what makes the
  // whole card (songs included) show the hand cursor — Tailwind v4 no
  // longer sets it on <button> by default.
  const overlayClass =
    "absolute inset-0 z-0 rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (item.kind === "artist") {
    return (
      <div className={cn(CARD_CLASS, "relative", className)}>
        <Link
          to="/artist/$id"
          params={{ id: item.id }}
          aria-label={item.title}
          className={overlayClass}
        />
        {body}
      </div>
    );
  }

  if (item.kind === "album") {
    return (
      <div className={cn(CARD_CLASS, "relative", className)}>
        <Link
          to="/album/$id"
          params={{ id: item.id }}
          aria-label={item.title}
          className={overlayClass}
        />
        {body}
      </div>
    );
  }

  if (item.kind === "playlist" && !item.playableVideoId) {
    return (
      <PlaylistPinContextMenu item={item}>
        <div className={cn(CARD_CLASS, "relative", className)}>
          <Link
            to="/playlist/$id"
            params={{ id: item.id }}
            aria-label={item.title}
            className={overlayClass}
          />
          {body}
        </div>
      </PlaylistPinContextMenu>
    );
  }

  // song / video, or a "playlist" card that's really a long-form video
  // (description-timestamp chapters) our /playlist/$id can't render —
  // clicking plays it. Right-click → context menu.
  const playItem: ShelfItem =
    item.kind === "playlist" && item.playableVideoId
      ? { ...item, kind: "song", id: item.playableVideoId }
      : item;
  return (
    <TrackContextMenu item={playItem}>
      <div className={cn(CARD_CLASS, "relative", className)}>
        <button
          type="button"
          aria-label={`Play ${item.title}`}
          className={overlayClass}
          onClick={() => usePlaybackStore.getState().playNow(playItem)}
        />
        {body}
      </div>
    </TrackContextMenu>
  );
}

function PlaylistPinContextMenu({
  item,
  children,
}: {
  item: ShelfItem;
  children: ReactNode;
}) {
  const pinned = useIsPinned(item.id);
  const hidden = useIsHidden(item.id);
  const pin = usePinnedPlaylistsStore((s) => s.pin);
  const unpin = usePinnedPlaylistsStore((s) => s.unpin);
  const hide = usePinnedPlaylistsStore((s) => s.hide);
  const unhide = usePinnedPlaylistsStore((s) => s.unhide);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {pinned ? (
          <ContextMenuItem onSelect={() => unpin(item.id)}>
            <PinOffIcon />
            Unpin from sidebar
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() =>
              pin({
                id: item.id,
                title: item.title,
                thumbnailUrl:
                  item.thumbnails[item.thumbnails.length - 1]?.url,
              })
            }
          >
            <PinIcon />
            Pin to sidebar
          </ContextMenuItem>
        )}
        {hidden ? (
          <ContextMenuItem onSelect={() => unhide(item.id)}>
            <EyeIcon />
            Show in sidebar
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => hide(item.id)}>
            <EyeOffIcon />
            Hide from sidebar
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
