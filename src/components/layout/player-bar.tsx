// Transport glyphs (play / pause / prev / next) stay on Lucide — they
// read better filled at this size than the Tabler equivalents. The
// footer row is Tabler, per the design.
import {
  IconArrowsMaximize,
  IconArrowsShuffle,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOnce,
} from "@tabler/icons-react";
import {
  IconVolumeFilled,
  IconVolume2Filled,
  IconVolume3Filled,
} from "@/components/shared/filled-icons";
// Fork note: IconLoader2/IconVideoFilled/IconMusicFilled from upstream's
// SourceToggle restyle are omitted — SourceToggle itself is omitted (see
// below); the song/video picker lives in the player menu.
import { QueueBody, QueueToggleButton } from "@/components/layout/queue-panel";
import {
  LyricsBody,
  LyricsSourceButton,
  useLyricsView,
} from "@/components/layout/lyrics-view";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import {
  Thumbnail,
  getRenderedThumbnailSrc,
} from "@/components/shared/thumbnail";
import { LikeDislikeButtons } from "@/components/shared/like-buttons";
import { ArtworkOutline } from "@/components/shared/artwork-outline";
import { ArtistLinks } from "@/components/shared/artist-links";
import { EntityLink } from "@/components/shared/entity-link";
import { PlayerMoreMenu } from "@/components/layout/player-more-menu";
import { PlayerCoverMenu } from "@/components/layout/player-cover-menu";
import {
  playerIconButton,
} from "@/components/layout/player-chrome";
import { cn } from "@/lib/utils";
import { usePlayerCoverDrag } from "@/lib/player-drag";
import { openCoverLightbox } from "@/lib/store/cover-lightbox";
import { openFullscreen } from "@/lib/store/fullscreen";
import { usePlaybackStore, currentTrack } from "@/lib/store/playback";
import { usePanelsStore } from "@/lib/store/panels";
import { useScrubStore } from "@/lib/store/scrub";
import { lookupITunesCover, cacheCoverToDisk } from "@/lib/cover-art";
import type { QueueTrack, RepeatMode } from "@/lib/store/playback";

/**
 * Look up a 3000×3000 studio cover from iTunes for the now-playing
 * track. We do this only for the big player-bar cover — every other
 * surface keeps the YT thumbnail (smaller surfaces don't need 3K, and
 * substituting iTunes art on cards would visually rewrite content the
 * user picked from YT). Result is cached in localStorage, so repeat
 * tracks don't hit the network.
 */
export function useITunesCover(track: QueueTrack | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const artistKey = track?.artists?.map((a) => a.name).join(", ") ?? "";
  const titleKey = track?.title ?? "";

  useEffect(() => {
    setUrl(null);
    if (!artistKey || !titleKey) return;
    let cancelled = false;
    (async () => {
      const itunes = await lookupITunesCover(artistKey, titleKey);
      if (cancelled || !itunes) return;
      const cached = await cacheCoverToDisk(itunes);
      if (cancelled) return;
      setUrl(cached);
    })();
    return () => {
      cancelled = true;
    };
  }, [artistKey, titleKey]);

  return url;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Human label for the current repeat mode. Doubles as the button's
 * tooltip and its `aria-label` so the three states (off → all → one)
 * are distinguishable — otherwise "off" and "all" differ only by the
 * icon's tint, which reads as "nothing happened" on the first click.
 */
export function repeatLabel(repeat: RepeatMode): string {
  return repeat === "one"
    ? "Repeat one"
    : repeat === "all"
      ? "Repeat all"
      : "Repeat off";
}

/* Fork note: SourceToggle intentionally omitted — fork moved the
   song/video picker into the player menu (0209432). Upstream's
   restyled toggle from 77b2c44 is skipped to preserve that decision. */
/** Elapsed-time label. Subscribes to the playhead itself so the 4×/s
 *  position ticks re-render this span, not the whole player. */
export function PlaybackTime() {
  const position = usePlaybackStore((s) => s.position);
  const scrub = useScrubStore((s) => s.scrub);
  return <>{formatTime(scrub ?? position)}</>;
}

/** Reads `position` and `scrub` from their stores (not props) so the
 *  playhead ticks re-render only the slider. */
export function ProgressSlider({
  duration,
  seek,
  disabled,
}: {
  duration: number;
  seek: (v: number) => void;
  disabled: boolean;
}) {
  const position = usePlaybackStore((s) => s.position);
  // Shared rather than local: the lyrics panel reads the live drag
  // target so its text follows the thumb instead of waiting for release.
  const scrub = useScrubStore((s) => s.scrub);
  const setScrub = useScrubStore((s) => s.setScrub);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // While the user is dragging the thumb, the slider thumb captures pointer
  // events so onMouseMove on the wrapper stops firing. Sync the tooltip with
  // the live `scrub` value instead.
  useEffect(() => {
    if (scrub === null) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const max = Math.max(duration, 1);
    setHoverX((scrub / max) * rect.width);
    setHoverTime(Math.round(scrub));
  }, [scrub, duration]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
        !disabled && "cursor-pointer",
      )}
      onMouseMove={(e) => {
        if (disabled || scrub !== null) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        setHoverX(x);
        setHoverTime(Math.round((x / rect.width) * Math.max(duration, 1)));
      }}
      onMouseLeave={() => {
        if (scrub !== null) return;
        setHoverX(null);
        setHoverTime(null);
      }}
    >
      {hoverX !== null && hoverTime !== null ? (
        <div
          className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded bg-black/85 px-2 py-0.5 text-sm font-medium tabular-nums text-white shadow"
          style={{ left: hoverX }}
        >
          {formatTime(hoverTime)}
        </div>
      ) : null}
      <Slider
        value={[scrub ?? position]}
        max={Math.max(duration, 1)}
        step={1}
        disabled={disabled}
        onValueChange={([v]) => setScrub(v)}
        onValueCommit={([v]) => {
          seek(v);
          setScrub(null);
        }}
      />
    </div>
  );
}

export function VolumeControl({
  direction = "horizontal",
  className,
}: {
  direction?: "horizontal" | "vertical";
  /** Extra classes for the speaker button (the full-screen chip). */
  className?: string;
}) {
  const { volume, muted } = usePlaybackStore(
    useShallow((s) => ({ volume: s.volume, muted: s.muted })),
  );
  const setVolume = usePlaybackStore((s) => s.setVolume);
  const toggleMute = usePlaybackStore((s) => s.toggleMute);
  const [open, setOpen] = useState(false);

  // Tabler ships three speaker states to Lucide's four, so the old
  // "audible but no waves" step folds into the single-wave icon.
  const Icon =
    muted || volume === 0
      ? IconVolume3Filled
      : volume < 0.6
        ? IconVolume2Filled
        : IconVolumeFilled;
  const pct = muted ? 0 : Math.round(volume * 100);

  // Horizontal: slider sits to the right of the speaker icon (right
  // card variant — there's room beside the button).
  // Vertical: slider pops upward (bottom bar — below the button is
  // the page edge, so the popup has to grow up).
  // Padding on the popup is invisible but counts toward the parent's
  // mouseleave hit-test, so the slider doesn't snap shut the moment
  // the cursor slips a couple px off the visible bar.
  const popupClass =
    direction === "vertical"
      ? "absolute bottom-full left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 px-3 pb-2 transition-opacity duration-150"
      : "absolute left-full top-1/2 z-10 flex -translate-y-1/2 items-center gap-0 py-3 pl-1 transition-opacity duration-150";

  return (
    <div
      className={cn(
        "relative flex items-center",
        // Horizontal (side card): the slider is always visible and grows
        // to fill whatever row space the resizable card gives it, so it
        // scales with the card instead of overflowing a fixed width.
        // Vertical (bottom bar) keeps the hover-popup layout below, so it
        // doesn't need the grow/min-w-0 treatment.
        direction === "horizontal" && "min-w-0 flex-1 gap-1",
        // Two invisible 8px strips (above and below the speaker button)
        // extend the container's hover hit-zone without overlapping the
        // button itself — overlapping it would steal its `:hover` state.
        // Together with the popup's own padding, the cursor gets a
        // comfortable grace area for traveling between icon and slider.
        // Only the vertical popup needs this grace zone.
        direction === "vertical" &&
          "before:absolute before:-top-2 before:inset-x-0 before:h-2 before:content-[''] after:absolute after:-bottom-2 after:inset-x-0 after:h-2 after:content-['']",
      )}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onWheel={(e) => {
        // Scroll wheel adjusts volume in 5% increments. Wheel-up
        // raises, wheel-down lowers. Unmutes on any change so the
        // change is audible.
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        // Adjust from the stored volume even when muted, so unmuting via the
        // wheel restores the real level instead of resetting to 5%.
        // setVolume already clears `muted`, so any wheel tick unmutes.
        const next = Math.max(0, Math.min(1, volume + delta));
        setVolume(next);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={toggleMute}
        className={cn(playerIconButton, className)}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={Icon.name}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.12 }}
            className="flex items-center justify-center"
          >
            <Icon />
          </motion.span>
        </AnimatePresence>
      </Button>
      {direction === "vertical" ? (
        <div
          className={cn(
            popupClass,
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <div className="flex w-12 flex-col items-center gap-2 rounded-md border border-hairline bg-surface-active/70 px-4 py-3 shadow backdrop-blur-md">
            <span className="text-xs font-medium tabular-nums text-foreground">
              {pct}
            </span>
            <Slider
              orientation="vertical"
              value={[pct]}
              max={100}
              step={1}
              className="h-16 min-h-0"
              aria-label="Volume"
              onValueChange={([v]) => setVolume(v / 100)}
            />
          </div>
        </div>
      ) : (
        // Inline, not a popup: grows to fill the row so its width tracks
        // the resizable side card instead of a fixed size overflowing it.
        // The min width is load-bearing outside the card: in the
        // full-screen transport row the container is shrink-to-fit, so a
        // pure flex-1 collapses the slider to a sliver.
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Slider
            value={[pct]}
            max={100}
            step={1}
            className="min-w-24 flex-1"
            aria-label="Volume"
            onValueChange={([v]) => setVolume(v / 100)}
          />
          <span className="w-7 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
            {pct}
          </span>
        </div>
      )}
    </div>
  );
}

export type PlayerBarVariant = "right" | "floating";

export function PlayerBar({
  variant = "right",
}: {
  variant?: PlayerBarVariant;
}) {
  const {
    playing,
    status,
    error,
    duration,
    shuffle,
    repeat,
  } = usePlaybackStore(
    useShallow((s) => ({
      playing: s.playing,
      status: s.status,
      error: s.error,
      duration: s.duration,
      shuffle: s.shuffle,
      repeat: s.repeat,
    })),
  );
  const track = usePlaybackStore(currentTrack);
  const toggle = usePlaybackStore((s) => s.toggle);
  const next = usePlaybackStore((s) => s.next);
  const prev = usePlaybackStore((s) => s.prev);
  const seek = usePlaybackStore((s) => s.seek);
  const setShuffle = usePlaybackStore((s) => s.setShuffle);
  const cycleRepeat = usePlaybackStore((s) => s.cycleRepeat);

  const [queueOpen, setQueueOpen] = useState(false);
  const iTunesCover = useITunesCover(track);
  const lyricsState = useLyricsView(track);
  const coverRef = useRef<HTMLDivElement>(null);
  // The cover doubles as a drag handle for layout switching. In the
  // floating window the OS title bar already owns drag, so we don't
  // attach our own handler there.
  const { onPointerDown: onCoverPointerDown } = usePlayerCoverDrag({
    enabled: variant !== "floating",
    onClick: () => {
      if (!track) return;
      const url = getRenderedThumbnailSrc(coverRef.current);
      if (url) openCoverLightbox(url, track.title);
    },
  });

  const hasTrack = !!track;
  // Only treat "loading" as user-facing when the user has actually
  // requested playback. The audio engine eagerly resolves the stream
  // URL for the queued track on mount (so the first click on Play is
  // instant), which flips status to "loading" even while playing is
  // still false — without this guard, the freshly-launched player
  // shows a spinner instead of the Play icon.
  const loading = status === "loading" && playing;

  // The right-side variant is fixed-positioned in the main app shell,
  // sized to the user's resizable card width. The floating-window
  // variant fills its parent container (the floating window's body,
  // whose own size the user resizes at the OS level instead), where
  // positioning is owned by that window's own layout.
  const cardWidth = usePanelsStore((s) => s.cardWidth);
  const wrapperClass =
    variant === "right"
      ? "fixed bottom-2 right-2 top-(--titlebar-h) z-10 flex flex-col rounded-[10px] border border-sidebar-border bg-surface"
      : "absolute inset-0 flex flex-col bg-surface";
  const wrapperStyle = variant === "right" ? { width: cardWidth } : undefined;

  return (
    // shadcn's SidebarProvider injects a nested TooltipProvider with
    // delayDuration={0} (for instant sidebar-icon labels), which
    // shadows the outer 800ms provider for everything inside the
    // shell. Wrap the player surface in its own provider so its
    // buttons get the slow delay we actually want here.
    // `skipDelayDuration={0}` makes EVERY hover wait the full delay,
    // even when moving between adjacent triggers (Radix defaults to
    // 300ms, which makes the next tooltip pop up instantly — annoying
    // when the buttons are densely packed).
    <TooltipProvider delayDuration={800} skipDelayDuration={0}>
    <aside className={wrapperClass} style={wrapperStyle}>
      {/* Queue overlay vs. cover-and-lyrics body. AnimatePresence
          crossfades the two when the user toggles the queue button.
          Both branches fill the card above the bottom action row
          (which stays rendered as the next aside child so the queue
          button remains accessible to toggle back). `initial={false}`
          suppresses an opening fade on first mount — the player
          opens with the cover already visible, no need to animate it
          in from blank. */}
      <AnimatePresence initial={false} mode="wait">
        {queueOpen ? (
          <motion.div
            key="queue"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.07 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <QueueBody onClose={() => setQueueOpen(false)} />
          </motion.div>
        ) : (
          <motion.div
            key="cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.07 }}
            className="flex min-h-0 flex-1 flex-col"
          >
      {/* Top fixed section: cover, meta, progress, controls.
          Floating variant drops the top padding so the cover sits
          flush against the window's title bar — there's no card
          border or chrome to motivate inset there. */}
      <div
        className={cn(
          "flex flex-col gap-3 p-4 pb-3",
          variant === "floating" && "pt-0",
        )}
      >
        {status === "error" && error ? (
          <div className="truncate rounded-md bg-destructive/90 px-3 py-1 text-xs text-destructive-foreground shadow">
            Playback error: {error}
          </div>
        ) : null}

        {/* `max-w-[20rem]` caps the cover at 320px so it can't grow
            arbitrarily tall in the floating variant when the user
            resizes the window wider — that would push the Play/Pause
            button below the visible area. The right-card variant has
            an effective inner width of 320 anyway (22rem - p-4*2), so
            the cap is a no-op there. */}
        <PlayerCoverMenu track={track}>
          <div
            ref={coverRef}
            onPointerDown={onCoverPointerDown}
            className={cn(
              "mx-auto w-full max-w-[20rem] touch-none select-none",
              variant !== "floating" && "cursor-zoom-in",
            )}
          >
            {track ? (
              // The wrapper carries the shadow so it is cast by the cover's
              // rounded box rather than by the Thumbnail's own square edge.
              //
              // `isolate` is load-bearing: the outline below blends, and a
              // blending element turns its nearest stacking-context ancestor
              // into an isolated group, which is also a backdrop root. Without
              // it that group is the motion.div wrapping cover AND lyrics, so
              // the lyrics' backdrop-blur strip loses the card and the app
              // background from its backdrop and paints as a dark band.
              <div className="group/cover relative isolate aspect-square w-full rounded-md shadow-[0_1px_14px_rgb(0_0_0/0.12)]">
                <Thumbnail
                  thumbnails={track.thumbnails}
                  alt={track.title}
                  className="size-full rounded-md pointer-events-none"
                  targetSize={1024}
                  highRes
                  overrideHighRes={iTunesCover}
                />
                <ArtworkOutline className="rounded-md" />
                {/* Hover pad with the Full screen chip, per the design.
                    Only the chip is clickable, and it stops the pointer
                    from reaching the cover's drag handle: the handle
                    captures the pointer, which would swallow the click.
                    The floating window has its own surface for this. */}
                {variant !== "floating" ? (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-(--g6a) opacity-0 transition-opacity duration-[160ms] group-hover/cover:opacity-100 has-[button:focus-visible]:opacity-100">
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={openFullscreen}
                      className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-[10px] bg-w160 px-3.5 py-[9px] text-[13px] font-semibold text-white backdrop-blur-[8px] transition-colors hover:bg-w200"
                    >
                      <IconArrowsMaximize className="size-[17px]" stroke={1.9} />
                      Full screen
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="aspect-square w-full rounded-md border border-hairline bg-muted" />
            )}
          </div>
        </PlayerCoverMenu>

        {/* Title + artist/album with heart on the right. The heart
            centres against the whole two-line block, per the design. */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium">
              {track?.title ?? "Nothing playing"}
            </span>
            {track ? (
              <span className="truncate text-sm text-muted-foreground">
                <ArtistLinks
                  artists={track.artists}
                  fallback={track.subtitle ?? ""}
                />
                {/* The separator only earns its place between two real
                    halves — a track with no artists must not open with
                    a stray dot. The album links through only when the
                    row it came from carried a browse id. */}
                {track.album ? (
                  <>
                    {track.artists?.length || track.subtitle ? " · " : null}
                    {track.albumId ? (
                      <EntityLink
                        to="/album/$id"
                        id={track.albumId}
                        event="nav:album"
                      >
                        {track.album}
                      </EntityLink>
                    ) : (
                      track.album
                    )}
                  </>
                ) : null}
              </span>
            ) : (
              <span className="truncate text-sm text-muted-foreground">
                Pick a track to start
              </span>
            )}
          </div>
          {track ? (
            <LikeDislikeButtons
              videoId={track.videoId}
              meta={track}
              className="shrink-0"
            />
          ) : null}
        </div>

        {/* Progress */}
        <div className="mt-2 flex flex-col gap-2.5">
          <ProgressSlider
            duration={duration}
            seek={seek}
            disabled={!hasTrack || duration <= 0}
          />
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span><PlaybackTime /></span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Main controls */}
        <div className="-mt-2 flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Shuffle"
            aria-pressed={shuffle}
            onClick={() => setShuffle(!shuffle)}
            className={cn(shuffle && "text-brand")}
          >
            <IconArrowsShuffle />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            onClick={prev}
            disabled={!hasTrack}
          >
            <IconPlayerSkipBackFilled />
          </Button>
          <Button
            size="icon"
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
            disabled={!hasTrack}
            className="size-12 rounded-full bg-brand text-white hover:bg-brand/90"
          >
            {loading ? (
              <IconLoader2 className="animate-spin" />
            ) : playing ? (
              <IconPlayerPauseFilled className="size-5" />
            ) : (
              <IconPlayerPlayFilled className="size-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            onClick={next}
            disabled={!hasTrack}
          >
            <IconPlayerSkipForwardFilled />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={repeatLabel(repeat)}
                aria-pressed={repeat !== "off"}
                onClick={cycleRepeat}
                className={cn(repeat !== "off" && "text-brand")}
              >
                {repeat === "one" ? <IconRepeatOnce /> : <IconRepeat />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{repeatLabel(repeat)}</TooltipContent>
          </Tooltip>
        </div>
      </div>

            {/* Lyrics flow — fills the rest of the cover-branch flex
                column. Lives inside the same motion.div as the cover
                so the whole non-queue body crossfades as one unit. */}
            <div className="flex min-h-0 flex-1 flex-col px-3">
              <LyricsBody state={lyricsState} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom row: lyrics-source + queue + volume on the left, more
          menu on the right. The volume slider grows to fill the left
          cluster so it scales with the resizable card instead of
          overflowing into the menu button. The song/video source
          picker lives inside `PlayerMoreMenu` now (its default
          `includeSource`) rather than as its own control here, which
          is what used to crowd the volume slider. `PlayerMoreMenu`
          handles the floating-window case internally — its
          `onGoToArtist` callback emits a Tauri nav event there
          instead of calling `useNavigate` (which would throw without
          a router). */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <LyricsSourceButton state={lyricsState} />
          <QueueToggleButton
            open={queueOpen}
            onToggle={() => setQueueOpen((v) => !v)}
          />
          <VolumeControl />
        </div>
        <PlayerMoreMenu track={track} />
      </div>
    </aside>
    </TooltipProvider>
  );
}
