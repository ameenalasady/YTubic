/**
 * Resume point for the last-played track, persisted separately from the
 * main playback store.
 *
 * Why not just add `position` to the store's `persist`? Position updates a
 * few times a second, and the store's persisted blob includes the whole
 * queue (up to 300 tracks) — folding position in would re-serialize that
 * blob every second during playback. This is a tiny, standalone key instead:
 * `{ videoId, position }`, throttled, so it stays cheap.
 */

const KEY = "ytm-playback-position";
const THROTTLE_MS = 3000;

export type SavedPosition = { videoId: string; position: number };

let lastWrite = 0;

/**
 * Persist the current playhead. Throttled to once per `THROTTLE_MS` unless
 * `force` is set (used on pause / seek / app hide so we don't lose the last
 * few seconds).
 */
export function savePlaybackPosition(
  videoId: string,
  position: number,
  force = false,
): void {
  if (!videoId || !Number.isFinite(position) || position < 0) return;
  const now = Date.now();
  if (!force && now - lastWrite < THROTTLE_MS) return;
  lastWrite = now;
  try {
    localStorage.setItem(KEY, JSON.stringify({ videoId, position }));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function loadPlaybackPosition(): SavedPosition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPosition;
    if (
      typeof parsed.videoId === "string" &&
      Number.isFinite(parsed.position) &&
      parsed.position > 0
    ) {
      return parsed;
    }
  } catch {
    /* corrupt / disabled — treat as no saved position */
  }
  return null;
}

export function clearPlaybackPosition(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
