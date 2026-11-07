import type { ShelfItem } from "@/lib/innertube/types";
import type { QueueTrack } from "@/lib/store/playback";

/**
 * Which row of a track list is the one playing.
 *
 * YouTube Music often has two ids for one song: the audio track (ATV) and
 * its music video (OMV). Different pages hand out different ones (an album
 * page may list the video id while Quick picks gave the audio id), and the
 * API offers no cheap way to look up the pair. So when no row carries the
 * playing id, fall back to matching the song itself: same title, same
 * artist, and either the same album or a near-identical duration.
 *
 * An exact id always wins, so a list holding both versions marks the right
 * one. If the fallback finds more than one candidate it marks none rather
 * than guess.
 */
export function findActiveIndex(
  tracks: readonly ShelfItem[],
  current: QueueTrack | null | undefined,
  /** Real duration from the audio element, used when the queue entry has none. */
  currentDuration?: number,
): number {
  if (!current) return -1;
  const exact = tracks.findIndex((t) => t.id === current.videoId);
  if (exact >= 0) return exact;

  const title = normalizeTitle(current.title);
  if (!title) return -1;
  const duration = current.duration || currentDuration || undefined;

  let found = -1;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.kind !== "song" && t.kind !== "video") continue;
    if (normalizeTitle(t.title) !== title) continue;
    if (!artistsOverlap(t.artists, current.artists)) continue;
    const sameAlbum =
      !!t.albumId && !!current.albumId && t.albumId === current.albumId;
    const sameLength =
      !!t.duration && !!duration && Math.abs(t.duration - duration) <= 3;
    if (!sameAlbum && !sameLength) continue;
    if (found >= 0) return -1;
    found = i;
  }
  return found;
}

/** Lowercase, accents dropped, "(feat. …)" dropped, punctuation collapsed. */
export function normalizeTitle(title: string | undefined): string {
  return (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[([](?:feat|ft|featuring|with)\b[^)\]]*[)\]]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Artist = { id?: string; name: string };

/** True when the lists share an artist, or when either side has none to compare. */
function artistsOverlap(
  a: readonly Artist[] | undefined,
  b: readonly Artist[] | undefined,
): boolean {
  if (!a?.length || !b?.length) return true;
  return a.some((x) =>
    b.some(
      (y) =>
        (!!x.id && x.id === y.id) ||
        normalizeTitle(x.name) === normalizeTitle(y.name),
    ),
  );
}
