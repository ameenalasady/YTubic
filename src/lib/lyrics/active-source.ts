import type { LyricsSource } from "@/lib/lyrics/sources";

/** The user's saved choice in the lyrics-source menu. */
export type LyricsPref = LyricsSource | "auto";

/** A one-track override set by "Reload lyrics": show this source's lyrics
 *  for this track, whatever the saved choice is. */
export type LyricsOverride = { videoId: string; source: LyricsSource };

/**
 * Which source's lyrics the panel shows.
 *
 * Normally the saved choice, or the best available one on "auto". After a
 * reload from LRCLIB, though, the fresh result would stay invisible whenever
 * another source ranks first (YouTube Music leads "auto"), so the reload
 * pins the track to the source it just fetched, for that track only, and
 * only while that source actually has lyrics to show.
 */
export function resolveActiveSource({
  pref,
  best,
  override,
  videoId,
  hasLyrics,
}: {
  pref: LyricsPref;
  best: LyricsSource | null;
  override: LyricsOverride | null;
  videoId: string | undefined;
  hasLyrics: (source: LyricsSource) => boolean;
}): LyricsSource | null {
  if (
    override &&
    videoId !== undefined &&
    override.videoId === videoId &&
    hasLyrics(override.source)
  ) {
    return override.source;
  }
  return pref === "auto" ? best : pref;
}
