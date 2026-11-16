import type { ShelfItem } from "@/lib/innertube/types";
import type { PlaylistSortMode } from "@/lib/store/playlist-sort";

/** `tracks` in the order `mode` asks for. "default" keeps the server's order. */
export function sortTracks(
  tracks: ShelfItem[],
  mode: PlaylistSortMode,
): ShelfItem[] {
  if (mode === "default" || tracks.length < 2) return tracks;
  const copy = tracks.slice();
  switch (mode) {
    case "date-added-asc":
      // YT serves Liked / user playlists newest-first. We don't have
      // a parseable timestamp on each row (the visible string is
      // localized — "Apr 23", "Yesterday", etc.), but a simple reverse
      // gives correct oldest-first order.
      copy.reverse();
      break;
    case "title-asc":
      copy.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "title-desc":
      copy.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case "artist-asc": {
      const key = (t: ShelfItem) => t.artists?.[0]?.name ?? t.subtitle ?? "";
      copy.sort((a, b) => key(a).localeCompare(key(b)));
      break;
    }
    case "duration-asc":
      copy.sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0));
      break;
    case "duration-desc":
      copy.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
      break;
  }
  return copy;
}
