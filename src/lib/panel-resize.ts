import { useCallback, useRef } from "react";

type Direction =
  /** Handle on the panel's right edge — dragging right grows it. */
  | "grow-right"
  /** Handle on the panel's left edge — dragging left grows it. */
  | "grow-left";

type Options = {
  getWidth: () => number;
  setWidth: (v: number) => void;
  direction: Direction;
  onReset?: () => void;
};

/**
 * Pointer-capture drag for a vertical resize handle, mirroring the
 * capture/cleanup pattern in `usePlayerCoverDrag` (lib/player-drag.ts).
 * `getWidth` is read fresh on pointerdown (not a captured prop) so a
 * width changed elsewhere between drags is always the real starting
 * point.
 */
export function usePanelResize({
  getWidth,
  setWidth,
  direction,
  onReset,
}: Options) {
  const startRef = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, width: getWidth() };

      const onMove = (ev: PointerEvent) => {
        const start = startRef.current;
        if (!start) return;
        const dx = ev.clientX - start.x;
        const delta = direction === "grow-right" ? dx : -dx;
        setWidth(start.width + delta);
      };
      const cleanup = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        startRef.current = null;
      };
      const onUp = () => cleanup();

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [getWidth, setWidth, direction],
  );

  return { onPointerDown, onDoubleClick: onReset };
}
