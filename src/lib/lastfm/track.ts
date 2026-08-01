/**
 * Shared conversion from the app's loose track metadata to the
 * `{ artist, track }` pair Last.fm's API expects. Used by both the
 * scrobbler and the love-sync path so they resolve the artist string
 * identically.
 *
 * The " - Topic" rule used to live here as its own regex while the lyrics
 * path had no equivalent; both now share `track-meta.ts`, which additionally
 * knows how to read a breadcrumb. The raw fallback is kept as a last resort,
 * so a breadcrumb shape the parser does not recognise still scrobbles
 * exactly as it did before rather than not at all.
 */

import {
  artistFromSubtitle,
  artistsFromList,
  stripTopicSuffix,
} from "@/lib/track-meta";

export type LastfmTrackMeta = {
  title?: string;
  artists?: { name: string }[];
  /** Free-form line under the title, used only when `artists` is empty. */
  subtitle?: string;
  album?: string;
};

export type LastfmTrackName = {
  artist: string;
  track: string;
  album?: string;
};

export function toLastfmTrack(m: LastfmTrackMeta): LastfmTrackName | null {
  const title = m.title?.trim();
  if (!title) return null;
  // Prefer the structured artist list; fall back to the subtitle breadcrumb
  // parsed down to a name (YT sometimes only gives us that), then the raw
  // subtitle with YouTube Music's " - Topic" channel suffix stripped — the
  // "Video • The Weeknd • 1B views" fallback of old is gone. No usable artist
  // → bail rather than send a channel/"views" string to Last.fm.
  const artist =
    artistsFromList(m.artists) ??
    artistFromSubtitle(m.subtitle) ??
    stripTopicSuffix(m.subtitle?.trim() ?? "");
  if (!artist) return null;
  return { artist, track: title, album: m.album?.trim() || undefined };
}
