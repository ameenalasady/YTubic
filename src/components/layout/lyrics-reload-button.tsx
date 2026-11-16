import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { IconRefresh } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** Same size, corner radius and spring as the quality switch pills. */
const SIZE = 36;
const RADIUS = 10;
const SPRING = {
  type: "spring",
  stiffness: 430,
  damping: 17,
  mass: 0.85,
} as const;

/**
 * Round "reload lyrics" button for the corner of the lyrics column.
 *
 * At rest it is a small circle. Hovering springs it open into a pill that
 * says what it does; releasing the mouse button starts the reload, folds it
 * back into the circle and spins the icon until the reload is over. It stays
 * a circle until the cursor has left and come back, so it does not pop open
 * again under a cursor that never moved.
 *
 * Cost: one element and one width spring while it is hovered. The spin is a
 * CSS transform animation that exists only while `reloading` is true, so a
 * resting button animates nothing and costs no layer.
 */
export function LyricsReloadButton({
  reloading,
  onReload,
  className,
}: {
  reloading: boolean;
  onReload: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [near, setNear] = useState(false);
  const [focused, setFocused] = useState(false);
  const contentRef = useRef<HTMLSpanElement>(null);
  // True between a press that started on the button and its release.
  const pressedRef = useRef(false);
  const [fullWidth, setFullWidth] = useState(0);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setFullWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A reload folds the button; it must not stay "near" afterwards.
  useEffect(() => {
    if (reloading) setNear(false);
  }, [reloading]);

  const open = (near || focused) && !reloading;

  return (
    <div
      // The padding (undone by the negative margin) makes the hover target a
      // little more forgiving than the 36px circle.
      className={cn("absolute bottom-2 right-2 z-10 -m-2 p-2", className)}
      onPointerEnter={() => setNear(true)}
      onPointerLeave={() => {
        setNear(false);
        pressedRef.current = false;
      }}
    >
      <motion.button
        type="button"
        aria-label="Reload lyrics"
        aria-busy={reloading}
        disabled={reloading}
        initial={false}
        animate={{
          width: open && fullWidth ? fullWidth + SIZE : SIZE,
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
        // Mouse: act on release. Only a press that began on the button
        // counts, so a text selection dragged across the lyrics and let go
        // over it does not start a reload.
        onPointerDown={(e) => {
          pressedRef.current = e.button === 0;
        }}
        onPointerUp={(e) => {
          const wasPressed = pressedRef.current;
          pressedRef.current = false;
          if (wasPressed && e.button === 0 && !reloading) onReload();
        }}
        // Keyboard: Enter / Space arrive as a click with detail 0. A real
        // mouse click has detail >= 1 and was already handled on release.
        onClick={(e) => {
          if (e.detail === 0 && !reloading) onReload();
        }}
        onFocus={(e) => {
          if (e.target.matches(":focus-visible")) setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        className="relative flex cursor-pointer items-center overflow-hidden border border-w080 bg-background/40 text-foreground shadow-md outline-none transition-[background-image] duration-150 [background-image:linear-gradient(var(--color-w090),var(--color-w090))] hover:[background-image:linear-gradient(var(--color-w140),var(--color-w140))] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <span
          className="grid shrink-0 place-items-center"
          style={{ width: SIZE - 2, height: SIZE - 2 }}
        >
          <IconRefresh
            className={cn("size-[17px]", reloading && "animate-spin")}
            aria-hidden
          />
        </span>
        <motion.span
          ref={contentRef}
          aria-hidden
          className="absolute left-[34px] top-0 flex h-full items-center whitespace-nowrap pr-3.5 text-[12.5px] font-semibold tracking-[0.01em]"
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: open ? 0.18 : 0.08, delay: open ? 0.07 : 0 }}
        >
          Reload lyrics
        </motion.span>
      </motion.button>
    </div>
  );
}
