import { useEffect, useState } from "react";
import { pickHighResThumbnail } from "@/components/shared/thumbnail";
import { cacheCoverToDisk } from "@/lib/cover-art";
import { usePlaybackStore, currentTrack } from "@/lib/store/playback";
import { useSettingsStore } from "@/lib/store/settings";

/**
 * Pick a vivid representative color from a cover image.
 * Downscales to 32x32, buckets pixels by hue, and weights each pixel by
 * saturation so a colorful accent beats a large grey/black background.
 * Returns "r, g, b" (ready for `rgba(var(--x), a)`), or null on failure.
 */
async function extractCoverColor(src: string): Promise<string | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null; // tainted canvas
  }

  const BUCKETS = 12;
  const acc = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.08 || l < 0.12 || l > 0.92) continue; // skip greys/near black/white
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    const bucket = Math.min(BUCKETS - 1, Math.floor((h / 6) * BUCKETS));
    const w = s * s * (1 - Math.abs(2 * l - 1) * 0.5);
    const a = acc[bucket];
    a.w += w;
    a.r += data[i] * w;
    a.g += data[i + 1] * w;
    a.b += data[i + 2] * w;
  }

  let best = acc[0];
  for (const a of acc) if (a.w > best.w) best = a;
  if (best.w <= 0) return null;

  let r = best.r / best.w;
  let g = best.g / best.w;
  let b = best.b / best.w;

  // Keep the glow bright enough to read on the dark UI: lift dark colors,
  // preserving hue, so it never disappears into the background.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const minLum = 130;
  if (lum < minLum) {
    const k = minLum / Math.max(lum, 1);
    r = Math.min(255, r * k);
    g = Math.min(255, g * k);
    b = Math.min(255, b * k);
  }
  return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
}

/**
 * Glowing outline around the window edge, in the accent color or (optionally)
 * the dominant color of the current cover.
 *
 * The window is opaque, so the glow is drawn inward from the edge as an
 * inset box-shadow overlay. It is click-through, pulses gently, and dims
 * while the window is not focused.
 */
export function WindowGlow() {
  const enabled = useSettingsStore((s) => s.windowGlow);
  const followCover = useSettingsStore((s) => s.windowGlowCover);
  const size = useSettingsStore((s) => s.windowGlowSize);
  const track = usePlaybackStore(currentTrack);
  const coverUrl =
    track?.thumbnails && track.thumbnails.length > 0
      ? pickHighResThumbnail(track.thumbnails)
      : null;

  const [focused, setFocused] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus(),
  );
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !followCover || !coverUrl) {
      setColor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const local = await cacheCoverToDisk(coverUrl);
      const c = await extractCoverColor(local);
      if (!cancelled) setColor(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, followCover, coverUrl]);

  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      className="window-glow pointer-events-none absolute inset-0 z-[60] rounded-[8px] transition-opacity duration-300"
      style={
        {
          opacity: focused ? 1 : 0.35,
          "--glow-rgb": color ?? "var(--acc1rgb)",
          "--glow-scale": size / 50,
        } as React.CSSProperties
      }
    />
  );
}
