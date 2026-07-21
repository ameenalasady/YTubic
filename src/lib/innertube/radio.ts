import type { ShelfItem } from "./types";
import { mapPlaylistPanelVideo, rawNext, type YtNode } from "./shared";

/**
 * Fetch a radio station seeded on a single videoId.
 * Equivalent to what YTM does when you click "Start radio" — /next with
 * playlistId `RDAMVM<videoId>` gives back a `playlistPanelRenderer` full
 * of similar tracks.
 *
 * Returns the seed track followed by ~24 recommended tracks.
 */
/** One page of a /next watch queue: tracks plus the pointer to the next page. */
export type WatchQueuePage = {
  tracks: ShelfItem[];
  continuationToken?: string;
};

/** Pull the queue rows out of a /next `playlistPanelRenderer` response. */
function parsePanel(json: YtNode): WatchQueuePage {
  // Initial responses nest the panel under the watch-next tabs;
  // continuation responses put it at continuationContents directly.
  const panel: YtNode | undefined =
    json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer ??
    json?.continuationContents?.playlistPanelContinuation;

  const tracks: ShelfItem[] = [];
  for (const c of (panel?.contents as YtNode[] | undefined) ?? []) {
    // YTM wraps rows that have both a song and a music-video version in a
    // playlistPanelVideoWrapperRenderer; the real row is under primaryRenderer.
    const row =
      c.playlistPanelVideoRenderer ??
      c.playlistPanelVideoWrapperRenderer?.primaryRenderer
        ?.playlistPanelVideoRenderer;
    if (!row) continue;
    const mapped = mapPlaylistPanelVideo(row);
    if (mapped) tracks.push(mapped);
  }

  let continuationToken: string | undefined;
  for (const c of (panel?.continuations as YtNode[] | undefined) ?? []) {
    continuationToken =
      c.nextContinuationData?.continuation ??
      c.nextRadioContinuationData?.continuation ??
      continuationToken;
  }
  return { tracks, continuationToken };
}

function parsePanelTracks(json: YtNode): ShelfItem[] {
  return parsePanel(json).tracks;
}

export async function fetchRadio(videoId: string): Promise<ShelfItem[]> {
  const tracks = parsePanelTracks(
    await rawNext({
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
    }),
  );
  if (import.meta.env.DEV) {
    console.debug("[radio] seed=", videoId, "tracks=", tracks.length);
  }
  return tracks;
}

/**
 * Build a play queue from a watch-playlist id — the kind the search
 * top-result card's Shuffle / Play button hands us: an artist shuffle
 * radio (`RDAO…`), an album (`OLAK…`), or a community playlist (`VL…` /
 * `RDCLAK…`). /next expands it into a `playlistPanelRenderer` of tracks.
 */
export async function fetchWatchQueue(
  playlistId: string,
  videoId?: string,
): Promise<ShelfItem[]> {
  const body: Record<string, unknown> = { playlistId, isAudioOnly: true };
  if (videoId) body.videoId = videoId;
  return parsePanelTracks(await rawNext(body));
}

/**
 * Server-side full-playlist shuffle. The playlist header's Shuffle button
 * carries a `watchPlaylistEndpoint` whose params embed the shuffle marker
 * (see `extractShuffleEndpoint` in playlist.ts); /next with those params
 * returns the first ~50 tracks of a fresh permutation over the ENTIRE
 * playlist — verified live: positions are uniform across the whole source
 * playlist and every call yields a new order — plus a continuation for
 * the rest of the permutation.
 */
export async function fetchShuffleQueue(
  playlistId: string,
  params: string,
): Promise<WatchQueuePage> {
  return parsePanel(await rawNext({ playlistId, params, isAudioOnly: true }));
}

/**
 * Next page of a watch queue. The shuffled permutation is finite: once
 * every track has been served YTM starts repeating, so callers must
 * dedupe against the existing queue and stop following continuations
 * when a page yields nothing new.
 */
export async function fetchWatchQueueContinuation(
  token: string,
): Promise<WatchQueuePage> {
  return parsePanel(await rawNext({ continuation: token }));
}
