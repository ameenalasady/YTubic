import { invoke } from "@tauri-apps/api/core";

/**
 * The Rust side runs a tiny axum server on a random localhost port that
 * streams yt-dlp output progressively. We query the port once and build
 * stream URLs from it.
 *
 * Every played track is cached to disk regardless of account tier — we're
 * downloading the bytes anyway, so keeping them makes replays instant.
 * The persistent cache is bounded by a user-configurable size limit
 * (Settings → Cache), enforced on the Rust side with oldest-first
 * eviction.
 */

let baseUrlPromise: Promise<string> | null = null;

async function fetchBaseUrl(): Promise<string> {
  // Up to ~2s of retries — the server starts asynchronously from Tauri
  // setup() and may not be listening yet when the first track plays.
  for (let i = 0; i < 20; i++) {
    try {
      return await invoke<string>("get_stream_base_url");
    } catch (e) {
      if (i === 19) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("unreachable");
}

export function getStreamBaseUrl(): Promise<string> {
  if (!baseUrlPromise) {
    baseUrlPromise = fetchBaseUrl().catch((e) => {
      baseUrlPromise = null; // retry next call
      throw e;
    });
  }
  return baseUrlPromise;
}

export async function streamUrlFor(videoId: string): Promise<string> {
  const base = await getStreamBaseUrl();
  return `${base}/stream/${encodeURIComponent(videoId)}`;
}

const prefetched = new Set<string>();

/**
 * Warm the disk cache for a videoId in the background. No-ops if we
 * already fired a prefetch for this id in this session. Runs for every
 * user now that caching is universal, so the next track is ready before
 * the user reaches it.
 *
 * The server itself is idempotent on a per-file basis (checks .part /
 * .webm existence), so re-firing is cheap but still skippable.
 */
export async function prefetchStream(videoId: string): Promise<void> {
  if (prefetched.has(videoId)) return;
  prefetched.add(videoId);
  try {
    const base = await getStreamBaseUrl();
    // Fire-and-forget — server returns 200/202 immediately and caches
    // bytes in the background. fetch() only rejects on network errors, so an
    // HTTP 4xx/5xx (yt-dlp spawn/extractor failure) resolves normally — drop
    // the warm mark on an error status so the id is retried later.
    const res = await fetch(`${base}/prefetch/${encodeURIComponent(videoId)}`);
    if (!res.ok) prefetched.delete(videoId);
  } catch {
    // If it fails we'll just fall through to on-demand fetch later.
    prefetched.delete(videoId);
  }
}

/**
 * Drop the in-memory "already prefetched" log. Call after the user
 * clears the disk cache via Settings — otherwise we'd never re-prefetch
 * tracks that are gone from disk but still remembered as "warm" here.
 */
export function clearPrefetchMemo(): void {
  prefetched.clear();
}
