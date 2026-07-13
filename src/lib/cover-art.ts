import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { createStore, del, entries, get, set } from "idb-keyval";

/**
 * iTunes Search API as a hi-res cover-art fallback.
 *
 * YT Music covers max out around 1000–2000 px for newer uploads, often
 * 226×226 for older / user-curated content. iTunes ships studio art
 * straight from labels at 3000×3000+. We use it ONLY for the now-playing
 * big cover — every other UI surface keeps the YT thumbnail to avoid
 * showing a different version's art (live → studio mismatch) on cards.
 *
 * No auth, no API key, CORS open. We route through `tauri-plugin-http`
 * because the Tauri webview's `connect-src` CSP doesn't list iTunes
 * (and we don't want it to — plugin-http goes through Rust, bypassing
 * CSP entirely for the network call). The actual `<img>` then loads
 * from `*.mzstatic.com`, which IS whitelisted in `img-src`.
 *
 * Found URLs are also pinned to disk via the `cache_cover` Tauri
 * command — see `cacheCoverToDisk` below. After the first lookup the
 * webview just streams bytes from `http://127.0.0.1:<port>/cover/...`,
 * which is hot in the browser image cache and survives restarts.
 */

const LEGACY_LOCALSTORAGE_PREFIX = "ytm-cover-itunes:";
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REQUEST_TIMEOUT_MS = 5000;

type CacheEntry = { url: string | null; expiresAt: number };

// In-flight dedupe — multiple consumers asking for the same track
// during a single render pass should share one network request.
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
}

// Dedicated IndexedDB store for this cache — deliberately its own database
// rather than a second store in `idb-storage.ts`'s `ytubic-stores` (an
// `idb-keyval` database has exactly one object store; a second store there
// would need a version-bumped schema migration). This used to live in
// localStorage as `ytm-cover-itunes:*` keys, but lazy TTL eviction (only on
// re-lookup) let thousands of ~200-byte keys accumulate in the same tight,
// shared quota that also held the query cache and every zustand store — see
// `query-client.ts` for the sibling fix. IndexedDB has a much larger,
// disk-backed quota.
const coverCacheStore =
  typeof window !== "undefined"
    ? createStore("ytubic-cover-cache", "urls")
    : undefined;

// In-memory mirror so repeat lookups within a session (e.g. a shelf
// re-rendering with the same tracks) resolve without an IndexedDB round
// trip. Populated on every read/write; never evicted independently — it's
// bounded by the same `MAX_COVER_KEYS` sweep since we only ever add entries
// that also exist in the durable store.
const memoCache = new Map<string, CacheEntry>();

async function readCache(key: string): Promise<CacheEntry | null> {
  const memoed = memoCache.get(key);
  if (memoed) {
    if (memoed.expiresAt < Date.now()) {
      memoCache.delete(key);
      return null;
    }
    return memoed;
  }
  if (!coverCacheStore) return null;
  try {
    const raw = await get<string>(key, coverCacheStore);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.expiresAt < Date.now()) {
      void del(key, coverCacheStore);
      return null;
    }
    memoCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// Hard cap on cover cache entries. Lazy TTL eviction (only on re-lookup)
// would otherwise let this grow without bound.
const MAX_COVER_KEYS = 500;
let writesSinceSweep = 0;

/** Drop expired/malformed cover entries and cap the total, evicting the
 *  soonest-to-expire first. Best-effort — never throws. */
async function sweepCoverCache(): Promise<void> {
  if (!coverCacheStore) return;
  try {
    const all = await entries<string, string>(coverCacheStore);
    const now = Date.now();
    const live: { key: string; expiresAt: number }[] = [];
    const dead: string[] = [];
    for (const [key, raw] of all) {
      const k = String(key);
      try {
        const e = JSON.parse(raw) as CacheEntry;
        if (e.expiresAt < now) dead.push(k);
        else live.push({ key: k, expiresAt: e.expiresAt });
      } catch {
        dead.push(k);
      }
    }
    await Promise.all(
      dead.map((k) => {
        memoCache.delete(k);
        return del(k, coverCacheStore);
      }),
    );
    if (live.length > MAX_COVER_KEYS) {
      live.sort((a, b) => a.expiresAt - b.expiresAt);
      const toEvict = live.slice(0, live.length - MAX_COVER_KEYS);
      await Promise.all(
        toEvict.map((e) => {
          memoCache.delete(e.key);
          return del(e.key, coverCacheStore);
        }),
      );
    }
  } catch {
    /* best-effort */
  }
}

async function writeCache(key: string, url: string | null): Promise<void> {
  if (!coverCacheStore) return;
  const ttl = url ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  const entry: CacheEntry = { url, expiresAt: Date.now() + ttl };
  memoCache.set(key, entry);
  try {
    await set(key, JSON.stringify(entry), coverCacheStore);
  } catch {
    // Quota exceeded (or disabled): sweep and retry once so a full cache
    // doesn't silently break persistence.
    await sweepCoverCache();
    try {
      await set(key, JSON.stringify(entry), coverCacheStore);
    } catch {
      /* still failing — skip caching this lookup */
    }
  }
  if (++writesSinceSweep >= 100) {
    writesSinceSweep = 0;
    void sweepCoverCache();
  }
}

// One-time migration: this cache used to persist to localStorage as
// `ytm-cover-itunes:*` keys. Drop the stale entries so that quota is
// actually reclaimed — leaving them in place would defeat the point of
// moving to IndexedDB.
if (typeof window !== "undefined") {
  try {
    const staleKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(LEGACY_LOCALSTORAGE_PREFIX)) staleKeys.push(k);
    }
    for (const k of staleKeys) window.localStorage.removeItem(k);
  } catch {
    // Nothing to reclaim if this throws — same best-effort shape as
    // `safeLocalStorage`.
  }
}

/**
 * iTunes thumbnail URLs end with "/<W>x<H><suffix>.<ext>", e.g.
 * "/100x100bb.jpg". The CDN clamps any size request to whatever max
 * was stored (typically 3000×3000 for music), so asking for 5000 is
 * safe — we just get whatever is highest available. The "bb" suffix
 * adds the small bordered look (visually identical to none for square
 * art), and "-999" is the undocumented "highest quality, minimal
 * recompression" trick used by the iTunes Artwork Finder community.
 */
function upgradeITunesArtwork(url: string): string {
  return url.replace(
    /\/\d+x\d+[a-z-]*\.(jpg|png)$/i,
    "/100000x100000-999.$1",
  );
}

export async function lookupITunesCover(
  artist: string,
  title: string,
): Promise<string | null> {
  if (!artist.trim() || !title.trim()) return null;
  const key = cacheKey(artist, title);

  // Registered synchronously (before any `await`) so two concurrent callers
  // for the same key can't both miss the in-flight map while each is
  // independently awaiting the (now-async) cache read below.
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const cached = await readCache(key);
      if (cached) return cached.url;

      const term = encodeURIComponent(`${artist} ${title}`);
      const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`;
      const res = await tauriFetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Don't cache transient HTTP failures.
        return null;
      }
      const json = (await res.json()) as {
        results?: { artworkUrl100?: string }[];
      };
      const artwork100 = json.results?.[0]?.artworkUrl100;
      const result = artwork100 ? upgradeITunesArtwork(artwork100) : null;
      await writeCache(key, result);
      return result;
    } catch {
      // Network error / timeout — also don't cache, let the next track
      // change retry.
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Ask the Rust side to download `url` (if it isn't on disk yet) and
 * return a `http://127.0.0.1:<port>/cover/<hash>.<ext>` URL the webview
 * can render via `<img src>`. The localhost stream server is allowed by
 * the CSP `img-src`, and the Cache-Control headers make the browser
 * keep the bytes resident for the session.
 *
 * Failures (no server yet, network down, 404 at source) fall through
 * to the original URL — the caller's `<img onError>` chain handles it.
 *
 * Two layers of dedup so a fully-rendered shelf with N cards doesn't
 * fire N concurrent invokes for the same URL:
 *   - In-memory map: once an upstream URL has been resolved this
 *     session, return the local URL synchronously.
 *   - In-flight map: if a resolve is already in progress, share the
 *     same promise.
 */
const diskCacheMemo = new Map<string, string>();
const diskCacheInflight = new Map<string, Promise<string>>();

export async function cacheCoverToDisk(url: string): Promise<string> {
  const memo = diskCacheMemo.get(url);
  if (memo) return memo;

  const pending = diskCacheInflight.get(url);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const local = await invoke<string>("cache_cover", { url });
      diskCacheMemo.set(url, local);
      return local;
    } catch (e) {
      console.warn("[cover-art] disk cache failed:", e);
      return url;
    } finally {
      diskCacheInflight.delete(url);
    }
  })();
  diskCacheInflight.set(url, promise);
  return promise;
}
