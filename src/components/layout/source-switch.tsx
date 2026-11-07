import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { IconLoader2, IconVideoFilled } from "@tabler/icons-react";
import { IconMusicFilled } from "@/components/shared/filled-icons";
import type { SourceKind } from "@/lib/store/track-source";
import type { VideoQuality } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

/** Same height and corner radius as the layout switch beside these pills. */
const SIZE = 36;
const RADIUS = 10;
/** Collapsed → expanded: a springy overshoot on the width. */
const SPRING = {
  type: "spring",
  stiffness: 430,
  damping: 17,
  mass: 0.85,
} as const;

type Option<T extends string | number> = {
  value: T;
  label: string;
  Icon?: ComponentType<{ className?: string }>;
  /** Shown faded: still clickable, but known to have nothing behind it. */
  dim?: boolean;
  title?: string;
};

/**
 * Glass pill with an accent capsule that glows and slides to the active
 * option. It rests as a round button showing the current choice, springs
 * open when the cursor comes near (or it is focused, or it is busy), and
 * folds back once the cursor leaves. Shared by the Song/Video switch and
 * the quality switch so they read as one family; `id` keeps each pill's
 * sliding capsule separate.
 */
function GlowPill<T extends string | number>({
  id,
  label,
  value,
  options,
  busy,
  collapsed,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: Option<T>[];
  busy?: T | null;
  /** What the round resting button shows. */
  collapsed: ReactNode;
  onChange: (v: T) => void;
}) {
  const reduce = useReducedMotion();
  const [near, setNear] = useState(false);
  const [focused, setFocused] = useState(false);
  // Start open for a moment so the control is discoverable.
  const [intro, setIntro] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fullWidth, setFullWidth] = useState(0);
  const tapTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), 2800);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(tapTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setFullWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = near || focused || intro || busy != null;

  return (
    // The padding (cancelled by the negative margin) widens the area in
    // which the cursor counts as "near" without moving anything.
    <div
      className="relative -m-3 p-3"
      onPointerEnter={() => setNear(true)}
      onPointerLeave={() => setNear(false)}
      // Only keyboard focus keeps the pill open. A mouse click also focuses
      // the button and leaves it focused, which used to hold the pill open
      // after the cursor had left, so it never folded back up.
      onFocus={(e) => {
        if (e.target.matches(":focus-visible")) setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onClick={() => {
        // Touch: a tap on the dot opens it. There is no "cursor leaves" on a
        // touch screen, so it folds back by itself a few seconds later.
        if (open) return;
        setNear(true);
        window.clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(() => setNear(false), 3000);
      }}
    >
      <motion.div
        role="radiogroup"
        aria-label={label}
        initial={false}
        animate={{
          width: open && fullWidth ? fullWidth + 2 : SIZE,
          borderRadius: open ? RADIUS : SIZE / 2,
        }}
        transition={
          reduce
            ? { duration: 0 }
            : {
                width: SPRING,
                borderRadius: { duration: 0.22, ease: "easeOut" },
              }
        }
        style={{ height: SIZE }}
        className="relative border border-w080 bg-w070 shadow-[0_10px_30px_-10px_var(--k900),0_0_0_1px_var(--w040)] backdrop-blur-xl"
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center text-(--fs-title)"
          animate={{ opacity: open ? 0 : 1, scale: open ? 0.6 : 1 }}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", stiffness: 520, damping: 22 }
          }
        >
          {collapsed}
        </motion.div>

        <motion.div
          ref={contentRef}
          className="absolute inset-y-0 left-0 flex w-max items-center gap-0.5 p-[3px]"
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: open ? 0.18 : 0.1, delay: open ? 0.07 : 0 }}
          style={{ pointerEvents: open ? "auto" : "none" }}
        >
          {options.map(({ value: v, label: text, Icon, dim, title }) => {
            const on = value === v;
            return (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={open ? 0 : -1}
                disabled={busy != null}
                title={title}
                onClick={() => onChange(v)}
                className={cn(
                  "relative flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[12px] font-semibold tracking-[0.02em] transition-colors duration-[160ms] disabled:cursor-default",
                  on ? "text-white" : "text-(--fs-seg) hover:text-(--fs-title)",
                  dim && !on && "opacity-45",
                )}
              >
                {on ? (
                  <motion.span
                    layoutId={id}
                    aria-hidden
                    className="absolute inset-0 rounded-[7px]"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(var(--acc1rgb), 1), rgba(var(--acc1rgb), 0.78))",
                      boxShadow:
                        "0 0 16px 2px rgba(var(--acc1rgb), 0.55), 0 0 40px 8px rgba(var(--acc1rgb), 0.28), inset 0 1px 0 rgba(255,255,255,0.3)",
                    }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span className="relative flex items-center gap-1.5">
                  {busy === v ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : Icon ? (
                    <Icon className="size-3.5" />
                  ) : null}
                  {text}
                </span>
              </button>
            );
          })}
        </motion.div>
      </motion.div>
    </div>
  );
}

const SOURCE_OPTIONS: Option<SourceKind>[] = [
  { value: "song", label: "Song", Icon: IconMusicFilled },
  { value: "video", label: "Video", Icon: IconVideoFilled },
];

/** Song / Video pill for the immersive fullscreen view. */
export function SourceSwitch({
  value,
  busy,
  videoUnavailable,
  onChange,
}: {
  value: SourceKind;
  busy: SourceKind | null;
  /** The lookup found no video for this track. */
  videoUnavailable?: boolean;
  onChange: (v: SourceKind) => void;
}) {
  const options = SOURCE_OPTIONS.map((o) =>
    o.value === "video" && videoUnavailable
      ? { ...o, dim: true, title: "No video available for this track" }
      : o,
  );
  const Current = options.find((o) => o.value === value)?.Icon;
  return (
    <GlowPill
      id="source-switch-pill"
      label="Playback source"
      value={value}
      options={options}
      busy={busy}
      collapsed={Current ? <Current className="size-[17px]" /> : null}
      onChange={onChange}
    />
  );
}

const QUALITY_OPTIONS: Option<VideoQuality>[] = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 1440, label: "1440p" },
];

/** Picture quality pill, shown next to the Song/Video pill in Video mode. */
export function QualitySwitch({
  value,
  onChange,
}: {
  value: VideoQuality;
  onChange: (v: VideoQuality) => void;
}) {
  return (
    <GlowPill
      id="quality-switch-pill"
      label="Video quality"
      value={value}
      options={QUALITY_OPTIONS}
      collapsed={
        <span className="text-[10.5px] font-bold tracking-tight">{value}</span>
      }
      onChange={onChange}
    />
  );
}
