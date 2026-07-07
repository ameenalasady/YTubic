/**
 * Shared conversion from the app's loose track metadata to the
 * `{ artist, track }` pair Last.fm's API expects. Used by both the
 * scrobbler and the love-sync path so they resolve the artist string
 * identically.
 */

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
  // Prefer the structured artist list; fall back to the free-form subtitle
  // (YT sometimes only gives us that). No usable artist → bail rather than
  // send a channel/"views" string to Last.fm.
  const artist = m.artists?.length
    ? m.artists
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ")
    : (m.subtitle?.trim() ?? "");
  if (!artist) return null;
  return { artist, track: title, album: m.album?.trim() || undefined };
}
