import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useTrackMetaStore, type TrackMeta } from "@/lib/store/track-meta";

/**
 * Back-fill track metadata for cache entries that predate the play-time
 * `track-meta` store (i.e. tracks cached before we started remembering
 * titles).
 *
 * We use YouTube's public oEmbed endpoint: no auth, no API key, tiny JSON
 * payload of `{ title, author_name }`. It's routed through `tauri-plugin-http`
 * (Rust) so it bypasses the webview CSP — `www.youtube.com` is already in the
 * http capability allow-list. Resolved records are written into the same
 * persisted store, so each videoId is fetched at most once, ever.
 */

const OEMBED_TIMEOUT_MS = 5000;

// Per-session negative cache: ids that came back 404/private/deleted. Keeps
// us from re-hitting oEmbed for the same dead videoId on every list refresh.
const failed = new Set<string>();
const inflight = new Map<string, Promise<TrackMeta | null>>();

export async function fetchTrackMetaOEmbed(
  videoId: string,
): Promise<TrackMeta | null> {
  const known = useTrackMetaStore.getState().byId[videoId];
  if (known) return known;
  if (failed.has(videoId)) return null;

  const existing = inflight.get(videoId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const watch = `https://www.youtube.com/watch?v=${videoId}`;
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        watch,
      )}&format=json`;
      const res = await tauriFetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
      });
      if (!res.ok) {
        failed.add(videoId);
        return null;
      }
      const json = (await res.json()) as {
        title?: string;
        author_name?: string;
      };
      if (!json.title) {
        failed.add(videoId);
        return null;
      }
      const meta: TrackMeta = {
        title: json.title,
        subtitle: json.author_name,
        artists: json.author_name ? [{ name: json.author_name }] : undefined,
      };
      useTrackMetaStore.getState().remember(videoId, meta);
      return meta;
    } catch {
      // Network error / timeout — retry-able, so don't add to the negative
      // cache. The next list refresh will try again.
      return null;
    } finally {
      inflight.delete(videoId);
    }
  })();

  inflight.set(videoId, promise);
  return promise;
}

/**
 * Resolve metadata for many ids with a small concurrency cap so we don't
 * fire a hundred simultaneous requests when the Cache list first opens.
 * Skips ids that are already known or already failed this session.
 */
export async function backfillTrackMeta(
  videoIds: string[],
  concurrency = 6,
): Promise<void> {
  const known = useTrackMetaStore.getState().byId;
  const queue = videoIds.filter((id) => !known[id] && !failed.has(id));
  if (!queue.length) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const id = queue[cursor++];
      await fetchTrackMetaOEmbed(id);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
}
