import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const HANDLES: { direction: ResizeDirection; className: string }[] = [
  { direction: "North", className: "top-0 inset-x-0 h-1.5 cursor-ns-resize" },
  {
    direction: "South",
    className: "bottom-0 inset-x-0 h-1.5 cursor-ns-resize",
  },
  { direction: "West", className: "left-0 inset-y-0 w-1.5 cursor-ew-resize" },
  { direction: "East", className: "right-0 inset-y-0 w-1.5 cursor-ew-resize" },
  {
    direction: "NorthWest",
    className: "top-0 left-0 size-3 cursor-nwse-resize",
  },
  {
    direction: "NorthEast",
    className: "top-0 right-0 size-3 cursor-nesw-resize",
  },
  {
    direction: "SouthWest",
    className: "bottom-0 left-0 size-3 cursor-nesw-resize",
  },
  {
    direction: "SouthEast",
    className: "bottom-0 right-0 size-3 cursor-nwse-resize",
  },
];

const isWindows =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

/**
 * Frameless WebKitGTK windows do not have the invisible native resize border
 * that WebView2 provides on Windows, so Linux needs explicit edge grips.
 */
export function WindowResizeHandles() {
  if (isWindows) return null;

  return (
    <>
      {HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          aria-hidden="true"
          className={`absolute z-50 ${className}`}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            void getCurrentWindow()
              .startResizeDragging(direction)
              .catch((error) => {
                console.error("[window] startResizeDragging failed:", error);
              });
          }}
        />
      ))}
    </>
  );
}
