import type { ShelfItem } from "./types";
import { mapPlaylistPanelVideo, rawNext, type YtNode } from "./shared";

/**
 * Pull the `playlistPanelRenderer` (first page) or its
 * `playlistPanelContinuation` (subsequent pages) out of a /next response.
 * Both carry the same `contents`/`continuations` shape.
 */
function extractPanel(json: YtNode): YtNode | undefined {
  return (
    json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer ??
    json?.continuationContents?.playlistPanelContinuation
  );
}

/** Map the track rows in a panel (or panel continuation) to ShelfItems. */
function parsePanelRows(panel: YtNode | undefined): ShelfItem[] {
  const panelContents: YtNode[] = panel?.contents ?? [];
  const tracks: ShelfItem[] = [];
  for (const c of panelContents) {
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
  return tracks;
}

/** Token that fetches the next page of panel rows, if there is one. */
function panelContinuationToken(panel: YtNode | undefined): string | undefined {
  const conts: YtNode[] = panel?.continuations ?? [];
  for (const c of conts) {
    const token =
      c?.nextRadioContinuationData?.continuation ??
      c?.nextContinuationData?.continuation;
    if (token) return token;
  }
  return undefined;
}

/** Pull the queue rows out of a /next `playlistPanelRenderer` response. */
function parsePanelTracks(json: YtNode): ShelfItem[] {
  return parsePanelRows(extractPanel(json));
}

/**
 * Fetch a radio station seeded on a single videoId.
 * Equivalent to what YTM does when you click "Start radio" — /next with
 * playlistId `RDAMVM<videoId>` gives back a `playlistPanelRenderer` full
 * of similar tracks.
 *
 * Returns the seed track followed by ~24 recommended tracks.
 */
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

// A single /next page only holds ~50 rows plus a continuation pointer to
// the rest. Following it keeps enough queued that playback doesn't run dry
// after one page and hand off to auto-radio mid-listen. Bound the walk so a
// long (or looping) station can't hang the queue build or stall the UI.
const MAX_CONTINUATION_PAGES = 8;
const MAX_QUEUE_TRACKS = 300;

/** Walk a panel's continuations, appending new (de-duped) rows to `tracks`. */
async function followPanelContinuations(
  panel: YtNode | undefined,
  tracks: ShelfItem[],
  opts?: { anonymous?: boolean },
): Promise<void> {
  const seen = new Set(tracks.map((t) => t.id));
  let token = panelContinuationToken(panel);
  for (
    let page = 0;
    token && page < MAX_CONTINUATION_PAGES && tracks.length < MAX_QUEUE_TRACKS;
    page++
  ) {
    const next = extractPanel(await rawNext({ continuation: token }, opts));
    let added = 0;
    for (const t of parsePanelRows(next)) {
      // Radio-style continuations can replay the same automix tail; skip
      // dupes so the queue keeps growing with genuinely new tracks.
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      tracks.push(t);
      added++;
    }
    // Nothing new on this page → we've reached the end (or a loop); stop.
    if (added === 0) break;
    token = panelContinuationToken(next);
  }
}

/**
 * One page of a shuffle station: the tracks plus the token that fetches the
 * next page (absent once the station is exhausted).
 */
export type StationPage = {
  tracks: ShelfItem[];
  continuation?: string;
};

/**
 * Fetch the first page of an artist's `RDAO…` shuffle station.
 *
 * Two things make this different from a normal watch queue:
 *
 * 1. It's requested **anonymously**. YTM freezes an RDAO station into one
 *    fixed order for a given visitorData (which the app always sends), so
 *    re-shuffling the same artist would otherwise replay the identical
 *    queue. Dropping the token lets YouTube re-roll the shuffle server-side,
 *    so each Shuffle is genuinely different.
 * 2. We keep YouTube's order and do **not** re-shuffle client-side. The
 *    station is already shuffled *and* front-loads the artist's own
 *    catalogue, trailing off into similar-artist radio; reshuffling would
 *    drag that radio tail up to the top of the queue.
 *
 * Only the first ~50-track page is fetched (fast); the player pages the
 * `continuation` token lazily as the queue nears its end via
 * {@link fetchShuffleContinuation}, so the station keeps extending itself
 * instead of falling back to auto-radio.
 */
export async function fetchArtistShuffle(
  playlistId: string,
): Promise<StationPage> {
  const panel = extractPanel(
    await rawNext({ playlistId, isAudioOnly: true }, { anonymous: true }),
  );
  const page: StationPage = {
    tracks: parsePanelRows(panel),
    continuation: panelContinuationToken(panel),
  };
  if (import.meta.env.DEV) {
    console.debug(
      "[artist-shuffle] id=",
      playlistId,
      "tracks=",
      page.tracks.length,
      "more=",
      !!page.continuation,
    );
  }
  return page;
}

/**
 * Fetch the next page of a shuffle station started by
 * {@link fetchArtistShuffle}. Anonymous so it stays on the same re-rolled
 * station, and returns the token for the page after this one (if any).
 */
export async function fetchShuffleContinuation(
  token: string,
): Promise<StationPage> {
  const panel = extractPanel(
    await rawNext({ continuation: token }, { anonymous: true }),
  );
  return {
    tracks: parsePanelRows(panel),
    continuation: panelContinuationToken(panel),
  };
}

/**
 * Build a play queue from a watch-playlist id — the kind the search
 * top-result card's Shuffle / Play button hands us: an artist shuffle
 * radio (`RDAO…`), an album (`OLAK…`), or a community playlist (`VL…` /
 * `RDCLAK…`). /next expands it into a `playlistPanelRenderer` of tracks,
 * and this follows its continuation tokens so a long album/playlist comes
 * back in full rather than just the first ~50-track page.
 */
export async function fetchWatchQueue(
  playlistId: string,
  videoId?: string,
): Promise<ShelfItem[]> {
  const body: Record<string, unknown> = { playlistId, isAudioOnly: true };
  if (videoId) body.videoId = videoId;

  const panel = extractPanel(await rawNext(body));
  const tracks = parsePanelRows(panel);
  await followPanelContinuations(panel, tracks);

  if (import.meta.env.DEV) {
    console.debug("[watch-queue] id=", playlistId, "tracks=", tracks.length);
  }
  return tracks;
}
