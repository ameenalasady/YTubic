import { memo, useEffect, useRef } from "react";
import { PlayIcon, ShuffleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Thumbnail } from "@/components/shared/thumbnail";
import { cn } from "@/lib/utils";
import {
  useEntityHeaderStore,
  type EntityHeaderConfig,
} from "@/lib/store/entity-header";

/**
 * Route header: a full hero that scrolls away as ordinary page
 * content, plus a compact bar that sticks to the top of the scroller
 * and fades in as the hero scrolls past.
 *
 * Architecture: rendered as the FIRST CHILD of `<main class="app-scroll">`
 * (the scroll container itself), not above it. The hero is then just
 * scroll content — no artificial height snap between a "hero" and
 * "compact" box, no resizing `<main>` on scroll, no virtualizer thrash
 * from a moving scrollport. That resize-avoidance was the reason the
 * previous version deliberately snapped height instead of animating
 * it; putting the hero inside the scroller removes the need for the
 * snap (and the jump it caused) entirely.
 *
 * The compact bar is a sibling placed immediately after the hero with
 * `margin-top: -COMPACT_HEIGHT`, so it overlaps the hero's own bottom
 * edge and contributes zero extra flow height — content below follows
 * the hero exactly as before. `position: sticky` still works from
 * that overlapped position: it has nowhere to stick to until the hero
 * has actually scrolled that far up, at which point it pins under the
 * title bar and fades to opaque.
 *
 * Performance: the fade is driven by direct DOM style writes on a ref
 * inside a rAF-throttled scroll handler — not React state — so
 * scrolling through the short fade window doesn't re-render anything.
 */

/** Fixed pixel height of the compact bar. */
const COMPACT_HEIGHT = 72;

/** Px of scroll, immediately before the compact bar would stick, over
 *  which it fades in — replaces the old binary 16px snap with a
 *  continuous transition so the first bit of scrolling has nothing to
 *  jump. */
const FADE_RANGE = 40;

export function EntityPageHeader() {
  const config = useEntityHeaderStore((s) => s.config);
  const heroRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const heroHeightRef = useRef(0);

  useEffect(() => {
    const hero = heroRef.current;
    const compact = compactRef.current;
    if (!hero || !compact) return;

    const applyProgress = (scrollTop: number) => {
      const threshold = heroHeightRef.current - COMPACT_HEIGHT;
      const fadeStart = threshold - FADE_RANGE;
      const t =
        FADE_RANGE <= 0
          ? scrollTop >= threshold
            ? 1
            : 0
          : Math.min(1, Math.max(0, (scrollTop - fadeStart) / FADE_RANGE));
      const active = t > 0.5;
      compact.style.opacity = String(t);
      compact.style.transform = `translate3d(0, ${(1 - t) * -6}px, 0)`;
      compact.style.pointerEvents = active ? "auto" : "none";
      compact.style.borderBottomColor = active
        ? "var(--border)"
        : "transparent";
      compact.setAttribute("aria-hidden", active ? "false" : "true");
    };

    const measure = () => {
      heroHeightRef.current = hero.offsetHeight;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hero);

    const scroller = compact.closest<HTMLElement>("main.app-scroll");
    if (!scroller) {
      return () => ro.disconnect();
    }

    let raf = 0;
    const tick = () => {
      raf = 0;
      applyProgress(scroller.scrollTop);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(tick);
    };
    tick();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [config]);

  if (!config) return null;

  return (
    // Hero and compact bar are DIRECT children of <main> (a Fragment,
    // not a wrapping div) — sticky positioning stays in effect only
    // within its parent's box, and that parent needs to span the rest
    // of the scrollable page, not just the hero's own height. A
    // wrapping div here would make the parent exactly `heroHeight`
    // tall (the negative margin below cancels the compact bar's own
    // contribution), so the compact bar would immediately un-stick
    // the moment its short parent scrolled out of view — it would
    // flash in, then disappear on the next bit of scroll. Parenting it
    // to <main> directly gives it the whole page to stay pinned to.
    <>
      <div ref={heroRef}>
        <HeroLayout config={config} />
      </div>
      <div
        ref={compactRef}
        aria-hidden="true"
        // `bg-surface`, not `bg-background` — this is the same
        // translucent-tint-over-the-blurred-cover recipe the sidebar
        // and player card use (no backdrop-blur needed; the blur
        // already happened once at the source, on BackgroundCover
        // itself). `bg-background/90` read as a flat, near-opaque dark
        // slab that ignored the ambient tint entirely.
        className="sticky top-0 z-20 border-b border-transparent bg-surface transition-[border-color] duration-200"
        style={{
          height: COMPACT_HEIGHT,
          marginTop: -COMPACT_HEIGHT,
          opacity: 0,
          pointerEvents: "none",
          willChange: "opacity, transform",
        }}
      >
        <CompactLayout config={config} />
      </div>
    </>
  );
}

const HeroLayout = memo(function HeroLayout({
  config,
}: {
  config: EntityHeaderConfig;
}) {
  const hasButtons = !!(config.onPlay || config.onShuffle || config.actions);
  return (
    <div
      className={cn(
        "flex flex-row gap-6 px-6 pt-3 pb-4",
        // Album/playlist covers are always exactly size-40, so bottom-
        // aligning with the text column reads as an intentional
        // baseline. An artist's text column (name + listeners +
        // description + Shuffle button) is often taller than the
        // size-40 avatar, and items-end would then push the avatar's
        // TOP below the title's top — the title visibly "pops out"
        // above the round avatar. Center them instead.
        config.round ? "items-center" : "items-end",
      )}
    >
      <Thumbnail
        thumbnails={config.thumbnails}
        alt={config.title}
        round={config.round}
        className={cn(
          "size-40 shrink-0",
          config.round ? "" : "border border-hairline shadow-lg",
        )}
        targetSize={512}
        highRes
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h1 className="truncate text-3xl font-bold leading-tight tracking-tight md:text-4xl">
          {config.title}
        </h1>
        {config.subtitle ? (
          <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {config.subtitle}
          </div>
        ) : null}
        {config.metadata ? (
          <p className="truncate text-xs text-muted-foreground">
            {config.metadata}
          </p>
        ) : null}
        {config.description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {config.description}
          </p>
        ) : null}
        {hasButtons ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {config.onPlay ? (
              <Button
                onClick={config.onPlay}
                className="bg-brand text-white hover:bg-brand/90"
              >
                <PlayIcon className="fill-current" />
                Play
              </Button>
            ) : null}
            {config.onShuffle ? (
              <Button variant="outline" onClick={config.onShuffle}>
                <ShuffleIcon />
                Shuffle
              </Button>
            ) : null}
            {config.actions}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const CompactLayout = memo(function CompactLayout({
  config,
}: {
  config: EntityHeaderConfig;
}) {
  const hasButtons = !!(config.onPlay || config.onShuffle || config.actions);
  return (
    <div className="flex h-full flex-row items-center gap-3 px-6">
      <Thumbnail
        thumbnails={config.thumbnails}
        alt={config.title}
        round={config.round}
        className={cn(
          "size-14 shrink-0",
          config.round ? "" : "border border-hairline shadow",
        )}
        targetSize={256}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-base font-semibold leading-tight">
          {config.title}
        </h2>
        {config.metadata ? (
          <p className="truncate text-xs text-muted-foreground">
            {config.metadata}
          </p>
        ) : null}
      </div>
      {hasButtons ? (
        <div className="flex shrink-0 items-center gap-2">
          {config.onPlay ? (
            <Button
              onClick={config.onPlay}
              size="sm"
              className="bg-brand text-white hover:bg-brand/90"
            >
              <PlayIcon className="fill-current" />
              Play
            </Button>
          ) : null}
          {config.onShuffle ? (
            <Button variant="outline" size="sm" onClick={config.onShuffle}>
              <ShuffleIcon />
              Shuffle
            </Button>
          ) : null}
          {config.actions}
        </div>
      ) : null}
    </div>
  );
});
