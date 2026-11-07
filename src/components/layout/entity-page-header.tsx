import { memo, useEffect, useRef } from "react";
import { IconArrowsShuffle, IconPlayerPlayFilled } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArtworkOutline } from "@/components/shared/artwork-outline";
import {
  getRenderedThumbnailSrc,
  Thumbnail,
} from "@/components/shared/thumbnail";
import { openCoverLightbox } from "@/lib/store/cover-lightbox";
import { cn } from "@/lib/utils";
import {
  useEntityHeaderStore,
  type EntityHeaderConfig,
} from "@/lib/store/entity-header";

const EXPANDED_HEIGHT = 184;
const COMPACT_HEIGHT = 66;
const COLLAPSE_DISTANCE = EXPANDED_HEIGHT - COMPACT_HEIGHT;
const TOOLBAR_HEIGHT = 60;
const COVER_SIZE = 148;
const COMPACT_COVER_SIZE = 44;
const COMPACT_ROUND_COVER_SIZE = 48;
const COVER_TOP = 18;
// Visual (post-scale) corner radius of the square cover. The single cover
// element shrinks by transform, which would shrink its radius along with it,
// so `apply()` divides these by the current scale to keep them literal.
const COVER_RADIUS = 12;
const COMPACT_COVER_RADIUS = 8;
const COMPACT_COVER_TOP = 11;
const COMPACT_ROUND_COVER_TOP = 9;
const INFO_LEFT = 206;
const COMPACT_INFO_LEFT = 82;
const COMPACT_ROUND_INFO_LEFT = 86;

const TITLE_HEIGHT = 46;
const SUBTITLE_HEIGHT = 24;
const METADATA_HEIGHT = 22;
const ACTIONS_GAP = 18;
const ACTIONS_HEIGHT = 36;

/**
 * Where the expanded header's title, detail lines and action row sit.
 * The block is centred vertically against the cover, so it depends on
 * which parts are present. Shared with `EntityHeaderSkeleton`, so the
 * loading state puts its bars exactly where the text will land.
 */
function heroGeometry(parts: {
  subtitle: boolean;
  metadata: boolean;
  actions: boolean;
}) {
  const detailsHeight =
    (parts.subtitle ? SUBTITLE_HEIGHT : 0) +
    (parts.metadata ? METADATA_HEIGHT : 0) +
    (parts.actions ? ACTIONS_GAP + ACTIONS_HEIGHT + 4 : 0);
  const titleTop = Math.max(
    COVER_TOP,
    (EXPANDED_HEIGHT - TITLE_HEIGHT - detailsHeight) / 2,
  );
  const detailsTop = titleTop + TITLE_HEIGHT;
  const actionsTop =
    detailsTop +
    (parts.subtitle ? SUBTITLE_HEIGHT : 0) +
    (parts.metadata ? METADATA_HEIGHT : 0) +
    ACTIONS_GAP;
  return { titleTop, detailsTop, actionsTop };
}

/**
 * One physical header that morphs using compositor-only transforms.
 * The scroller permanently reserves the expanded height, so every pixel of
 * wheel movement remains one pixel of content movement. No layout property is
 * changed while scrolling and no geometry is read from the hot scroll path.
 */
export function EntityPageHeader() {
  const config = useEntityHeaderStore((s) => s.config);
  const hasConfig = config !== null;
  const hasToolbar = config?.toolbar != null;
  const keepSubtitleInCompact = config?.keepSubtitleInCompact === true;
  const useLargeCompactAvatar = config?.round === true;
  const setHeaderHeight = useEntityHeaderStore((s) => s.setHeaderHeight);
  const headerRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const coverOutlineRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef({
    titleTop: 0,
    actionsTop: 0,
    actionsX: 0,
  });

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("main.app-scroll");
    const scrollContent = scroller?.querySelector<HTMLElement>(
      ":scope > .app-scroll-content",
    );
    const header = headerRef.current;
    const cover = coverRef.current;
    const title = titleRef.current;
    const details = detailsRef.current;
    if (
      !scroller ||
      !scrollContent ||
      !header ||
      !cover ||
      !title ||
      !details ||
      !hasConfig
    )
      return;

    const toolbarHeight = hasToolbar ? TOOLBAR_HEIGHT : 0;
    const expandedTotalHeight = EXPANDED_HEIGHT + toolbarHeight;
    const compactTotalHeight = COMPACT_HEIGHT + toolbarHeight;
    setHeaderHeight(expandedTotalHeight);
    let frame = 0;

    // Geometry is measured only when content or the window size changes.
    // The resulting deltas are cached and reused throughout scrolling.
    const measure = () => {
      const actions = actionsRef.current;
      geometryRef.current = {
        titleTop: title.offsetTop,
        actionsTop: actions?.offsetTop ?? 0,
        actionsX: actions
          ? header.clientWidth - 24 - actions.offsetWidth - INFO_LEFT
          : 0,
      };
    };

    const apply = () => {
      frame = 0;
      const top = Math.max(0, scroller.scrollTop);
      const progress = Math.min(1, top / COLLAPSE_DISTANCE);
      const { titleTop, actionsTop, actionsX } = geometryRef.current;
      const compactCoverSize = useLargeCompactAvatar
        ? COMPACT_ROUND_COVER_SIZE
        : COMPACT_COVER_SIZE;
      const compactCoverTop = useLargeCompactAvatar
        ? COMPACT_ROUND_COVER_TOP
        : COMPACT_COVER_TOP;
      const compactInfoLeft = useLargeCompactAvatar
        ? COMPACT_ROUND_INFO_LEFT
        : COMPACT_INFO_LEFT;
      const coverScale = 1 - progress * (1 - compactCoverSize / COVER_SIZE);
      const titleScale = 1 - progress * 0.45;
      // Keep subtitle/metadata visually attached to the moving title.
      // They remain fully readable through the first part of the morph,
      // then fade only as the compact bar runs out of vertical room.
      const detailFade = keepSubtitleInCompact
        ? 0
        : Math.min(1, Math.max(0, (progress - 0.35) / 0.25));
      const detailOpacity = 1 - detailFade;
      const infoX = (compactInfoLeft - INFO_LEFT) * progress;
      const compactTitleTop = keepSubtitleInCompact ? 8 : 20;
      const infoY = (compactTitleTop - titleTop) * progress;
      // Follow the title's visual bottom edge, including the height it
      // loses while scaling. Without this compensation the subtitle's
      // gap grows and makes it look as if it drifts downward.
      const detailsY = keepSubtitleInCompact
        ? (32 - (titleTop + 46)) * progress
        : infoY + 46 * (titleScale - 1) - 8 * progress;

      cover.style.transform = `translate3d(0, ${(compactCoverTop - COVER_TOP) * progress}px, 0) scale(${coverScale})`;
      // Anything drawn on top of the artwork (the Liked cover picker) is
      // scaled with it, so it steps aside once the morph is under way
      // rather than riding along at a third of its size.
      cover.dataset.compact = progress > 0.2 ? "true" : "false";
      if (!useLargeCompactAvatar) {
        const radius =
          COVER_RADIUS + (COMPACT_COVER_RADIUS - COVER_RADIUS) * progress;
        cover.style.borderRadius = `${radius / coverScale}px`;
      }
      // Same compensation for the outline: a plain 1px border would be
      // scaled down to a third of a pixel by the time the header is fully
      // collapsed, leaving the compact cover with no visible edge.
      const coverOutline = coverOutlineRef.current;
      if (coverOutline) {
        coverOutline.style.borderWidth = `${1 / coverScale}px`;
      }
      title.style.transform = `translate3d(${infoX}px, ${infoY}px, 0) scale(${titleScale})`;
      details.style.opacity = String(detailOpacity);
      details.style.visibility = detailOpacity <= 0 ? "hidden" : "visible";
      details.style.transform = `translate3d(${infoX}px, ${detailsY}px, 0)`;

      const actions = actionsRef.current;
      if (actions) {
        actions.style.transform = `translate3d(${actionsX * progress}px, ${(13 - actionsTop) * progress}px, 0)`;
      }

      const toolbar = toolbarRef.current;
      if (toolbar) {
        toolbar.style.transform = `translate3d(0, ${-Math.min(top, COLLAPSE_DISTANCE)}px, 0)`;
      }

      const clipHeight = Math.max(
        compactTotalHeight,
        expandedTotalHeight - top,
      );
      // Clip only the route content. Applying this to the scroller itself
      // would also cut its native scrollbar under the header.
      scrollContent.style.clipPath = `inset(${top + clipHeight}px 0 0 0)`;
    };

    const scheduleApply = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    measure();
    apply();
    const resizeObserver = new ResizeObserver(() => {
      measure();
      scheduleApply();
    });
    resizeObserver.observe(header);
    if (actionsRef.current) resizeObserver.observe(actionsRef.current);
    scroller.addEventListener("scroll", scheduleApply, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", scheduleApply);
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scrollContent.style.clipPath = "";
    };
    // Playlist pages publish fresh callback/action identities whenever a
    // continuation lands. The scroll driver depends only on the header being
    // mounted, not on those identities, so keep it alive across config updates.
  }, [
    hasConfig,
    hasToolbar,
    keepSubtitleInCompact,
    setHeaderHeight,
    useLargeCompactAvatar,
  ]);

  if (!config) return null;

  const hasActions = !!(config.onPlay || config.onShuffle || config.actions);
  const { titleTop, detailsTop, actionsTop } = heroGeometry({
    subtitle: !!config.subtitle,
    metadata: !!config.metadata,
    actions: hasActions,
  });

  return (
    <div
      ref={headerRef}
      // Named container so header actions can tighten up when the
      // window is too narrow for their full labels.
      className="@container/hdr pointer-events-none absolute inset-x-0 top-0 z-20"
      style={{
        height: EXPANDED_HEIGHT + (hasToolbar ? TOOLBAR_HEIGHT : 0),
      }}
    >
      <div
        ref={coverRef}
        className="group/cover pointer-events-auto absolute left-6 top-[18px] size-[148px] origin-top-left"
        style={{
          willChange: "transform",
          borderRadius: config.round ? undefined : COVER_RADIUS,
        }}
      >
        {config.cover ?? (
          <Thumbnail
            thumbnails={config.thumbnails}
            alt={config.title}
            round={config.round}
            className={cn(
              "size-full",
              !config.round && "rounded-[inherit] shadow-lg",
            )}
            targetSize={512}
            highRes
          />
        )}
        <ArtworkOutline
          ref={coverOutlineRef}
          className={config.round ? "rounded-full" : "rounded-[inherit]"}
        />
        {config.enlargeCover &&
        config.cover == null &&
        config.thumbnails.length > 0 ? (
          <button
            type="button"
            aria-label={`Enlarge artwork for ${config.title}`}
            aria-haspopup="dialog"
            className="absolute inset-0 cursor-zoom-in rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => {
              const url = getRenderedThumbnailSrc(coverRef.current);
              if (url) openCoverLightbox(url, config.title);
            }}
          />
        ) : null}
      </div>

      <h1
        ref={titleRef}
        className="pointer-events-auto absolute right-6 min-w-0 origin-top-left truncate text-[40px] font-bold leading-[1.15] tracking-tight"
        style={{ left: INFO_LEFT, top: titleTop, willChange: "transform" }}
      >
        {config.title}
      </h1>

      <div
        ref={detailsRef}
        className="pointer-events-auto absolute right-6"
        style={{
          left: INFO_LEFT,
          top: detailsTop,
          willChange: "opacity, transform",
        }}
      >
        {config.subtitle ? (
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {config.subtitle}
          </p>
        ) : null}
        {config.metadata ? (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            {config.metadata}
          </p>
        ) : null}
      </div>

      {hasActions ? (
        <div
          ref={actionsRef}
          className="pointer-events-auto absolute flex shrink-0 items-center gap-2"
          style={{
            left: INFO_LEFT,
            top: actionsTop,
            willChange: "transform",
          }}
        >
          <HeaderActions config={config} />
        </div>
      ) : null}

      {config.toolbar ? (
        <div
          ref={toolbarRef}
          className="pointer-events-auto absolute inset-x-6 top-[184px] h-[60px] pt-[11px]"
          style={{ willChange: "transform" }}
        >
          {config.toolbar}
        </div>
      ) : null}
    </div>
  );
}

const HeaderActions = memo(function HeaderActions({
  config,
}: {
  config: EntityHeaderConfig;
}) {
  return (
    <>
      {config.onPlay ? (
        <Button onClick={config.onPlay}>
          <IconPlayerPlayFilled />
          Play
        </Button>
      ) : null}
      {config.onShuffle ? (
        <Button variant="secondary" onClick={config.onShuffle}>
          <IconArrowsShuffle />
          Shuffle
        </Button>
      ) : null}
      {config.actions}
    </>
  );
});

/**
 * Loading stand-in for the expanded header, drawn in flow at the top of
 * the scroller. It takes the same height the real header reserves and
 * places each bar with `heroGeometry`, so when the data lands the cover,
 * title, detail lines and buttons appear exactly where the bars were.
 *
 * `actions` lists one width class per button (`w-9` for an icon button).
 */
export function EntityHeaderSkeleton({
  subtitle = false,
  metadata = false,
  actions = [],
  round = false,
  toolbar = false,
}: {
  subtitle?: boolean;
  metadata?: boolean;
  actions?: string[];
  round?: boolean;
  /** A search field pinned under the header, like Top songs has. */
  toolbar?: boolean;
}) {
  const { titleTop, detailsTop, actionsTop } = heroGeometry({
    subtitle,
    metadata,
    actions: actions.length > 0,
  });
  const metadataTop = detailsTop + (subtitle ? SUBTITLE_HEIGHT : 0);
  return (
    <div
      aria-hidden
      className="@container/hdr relative shrink-0"
      style={{ height: EXPANDED_HEIGHT + (toolbar ? TOOLBAR_HEIGHT : 0) }}
    >
      <Skeleton
        className={cn(
          "absolute left-6 border border-hairline",
          round ? "rounded-full" : "rounded-xl",
        )}
        style={{ top: COVER_TOP, width: COVER_SIZE, height: COVER_SIZE }}
      />
      {/* Bars cover the glyphs, not the line box: 40px type on a 46px
          line, 14px on 20px, 12px on 16px. */}
      <Skeleton
        className="absolute h-[34px] w-[min(16rem,calc(100%-230px))] rounded-lg"
        style={{ left: INFO_LEFT, top: titleTop + 6 }}
      />
      {subtitle ? (
        <Skeleton
          className="absolute h-3.5 w-40"
          style={{ left: INFO_LEFT, top: detailsTop + 7 }}
        />
      ) : null}
      {metadata ? (
        <Skeleton
          className="absolute h-3 w-32"
          style={{ left: INFO_LEFT, top: metadataTop + 8 }}
        />
      ) : null}
      {actions.length > 0 ? (
        <div
          className="absolute flex items-center gap-2"
          style={{ left: INFO_LEFT, top: actionsTop }}
        >
          {actions.map((w, i) => (
            <Skeleton key={i} className={cn("h-9 rounded-lg", w)} />
          ))}
        </div>
      ) : null}
      {toolbar ? (
        <div className="absolute inset-x-6 top-[184px] h-[60px] pt-[11px]">
          <Skeleton className="h-8 w-full rounded-[10px]" />
        </div>
      ) : null}
    </div>
  );
}
