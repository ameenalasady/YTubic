import { useCallback, useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import {
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_PLAYER_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_PLAYER_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useLayoutStore,
} from "@/lib/store/layout";
import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 8;

type ResizeHandleProps = {
  value: number;
  min: number;
  max: number;
  label: string;
  edge: "left" | "right";
  cssVariable: "--sidebar-width" | "--player-width";
  onChange: (value: number) => void;
  onReset: () => void;
  onBelowMin?: () => void;
  onIncrease?: () => void;
  initiallyBelowMin?: boolean;
  collapseDeadzone?: number;
  expandDistance?: number;
  className?: string;
  style?: React.CSSProperties;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ResizeHandle({
  value,
  min,
  max,
  label,
  edge,
  cssVariable,
  onChange,
  onReset,
  onBelowMin,
  onIncrease,
  initiallyBelowMin = false,
  collapseDeadzone = 0,
  expandDistance = 0,
  className,
  style,
}: ResizeHandleProps) {
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    lastWidth: number;
    belowMin: boolean;
    collapsedAtWidth: number;
  } | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const previousBodyStyleRef = useRef<
    { cursor: string; userSelect: string } | undefined
  >(undefined);

  const restoreInteractionStyles = useCallback(() => {
    document.body.classList.remove("layout-resizing");
    const previous = previousBodyStyleRef.current;
    if (previous) {
      document.body.style.cursor = previous.cursor;
      document.body.style.userSelect = previous.userSelect;
      previousBodyStyleRef.current = undefined;
    }
  }, []);

  const finishDrag = useCallback(
    (commit = true) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      targetRef.current?.style.setProperty(
        cssVariable,
        `${drag.lastWidth}px`,
      );
      dragRef.current = null;
      targetRef.current = null;
      restoreInteractionStyles();
      if (commit) onChange(drag.lastWidth);
    },
    [cssVariable, onChange, restoreInteractionStyles],
  );

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      restoreInteractionStyles();
    };
  }, [restoreInteractionStyles]);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={cn(
        "absolute bottom-2 top-0 z-30 hidden w-3 touch-none cursor-col-resize outline-none md:block",
        className,
      )}
      style={style}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          startX: event.clientX,
          startWidth: value,
          lastWidth: value,
          belowMin: initiallyBelowMin,
          collapsedAtWidth: value,
        };
        targetRef.current = event.currentTarget.closest(
          '[data-slot="sidebar-wrapper"]',
        ) as HTMLElement | null;
        previousBodyStyleRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.classList.add("layout-resizing");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = event.clientX - drag.startX;
        const next = drag.startWidth + (edge === "left" ? delta : -delta);
        if (drag.belowMin) {
          if (next < drag.collapsedAtWidth + expandDistance) return;
          drag.belowMin = false;
          drag.startX = event.clientX;
          drag.startWidth = min;
          drag.lastWidth = min;
          targetRef.current?.style.setProperty(cssVariable, `${min}px`);
          onIncrease?.();
          return;
        }
        if (next <= min - collapseDeadzone && onBelowMin) {
          if (!drag.belowMin) {
            drag.belowMin = true;
            drag.collapsedAtWidth = next;
            drag.lastWidth = min;
            targetRef.current?.style.setProperty(cssVariable, `${min}px`);
            onBelowMin();
          }
          return;
        }
        drag.lastWidth = clamp(next, min, max);
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const activeDrag = dragRef.current;
            if (!activeDrag) return;
            targetRef.current?.style.setProperty(
              cssVariable,
              `${activeDrag.lastWidth}px`,
            );
          });
        }
      }}
      onPointerUp={() => finishDrag()}
      onPointerCancel={() => finishDrag()}
      onLostPointerCapture={() => finishDrag()}
      onKeyDown={(event) => {
        let delta = 0;
        if (event.key === "ArrowLeft") delta = -KEYBOARD_STEP;
        if (event.key === "ArrowRight") delta = KEYBOARD_STEP;
        if (!delta) return;
        event.preventDefault();
        onChange(clamp(value + (edge === "left" ? delta : -delta), min, max));
      }}
    />
  );
}

export function SidebarResizeHandle() {
  const { state, isMobile, setOpen } = useSidebar();
  const width = useLayoutStore((s) => s.sidebarWidth);
  const setWidth = useLayoutStore((s) => s.setSidebarWidth);

  if (isMobile) return null;

  const collapsed = state === "collapsed";

  return (
    <ResizeHandle
      value={width}
      min={MIN_SIDEBAR_WIDTH}
      max={MAX_SIDEBAR_WIDTH}
      label="Resize sidebar"
      edge="left"
      cssVariable="--sidebar-width"
      onChange={(next) => {
        if (collapsed) {
          if (next > MIN_SIDEBAR_WIDTH) {
            setWidth(MIN_SIDEBAR_WIDTH);
            setOpen(true);
          }
          return;
        }
        setWidth(next);
      }}
      onReset={() => {
        if (collapsed) {
          setWidth(MIN_SIDEBAR_WIDTH);
          setOpen(true);
        } else {
          setWidth(DEFAULT_SIDEBAR_WIDTH);
        }
      }}
      onBelowMin={
        collapsed
          ? undefined
          : () => {
              setWidth(MIN_SIDEBAR_WIDTH);
              setOpen(false);
            }
      }
      onIncrease={() => {
        setWidth(MIN_SIDEBAR_WIDTH);
        setOpen(true);
      }}
      initiallyBelowMin={collapsed}
      collapseDeadzone={64}
      expandDistance={80}
      style={{
        left: collapsed
          ? `calc(var(--sidebar-width-icon) + 0.25rem)`
          : `calc(var(--sidebar-width) - 0.875rem)`,
      }}
    />
  );
}

export function PlayerResizeHandle() {
  const width = useLayoutStore((s) => s.playerWidth);
  const setWidth = useLayoutStore((s) => s.setPlayerWidth);

  return (
    <ResizeHandle
      value={width}
      min={MIN_PLAYER_WIDTH}
      max={MAX_PLAYER_WIDTH}
      label="Resize player"
      edge="right"
      cssVariable="--player-width"
      onChange={setWidth}
      onReset={() => setWidth(DEFAULT_PLAYER_WIDTH)}
      style={{ right: `calc(var(--player-width) + 0.125rem)` }}
    />
  );
}
