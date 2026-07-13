import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createStore, del, get, set } from "idb-keyval";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min — InnerTube responses rarely change
      gcTime: 1000 * 60 * 60 * 24, // 24h in cache so hydration from disk has something to return
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Dedicated IndexedDB store for the query cache. This used to live in
 * localStorage, but that quota is shared with every small zustand
 * preference (home section order, playback queue, cover-art cache, ...)
 * on WebKitGTK, whose quota is tight. Lyrics alone accumulate for every
 * track played over a 7-day window (see `shouldPersistQuery` below) and
 * were eating enough of that shared quota that unrelated preference
 * writes started silently failing (see `safeLocalStorage`) and
 * resetting on relaunch. IndexedDB has a much larger, disk-backed quota,
 * so moving this here frees localStorage for everything else.
 */
const idbStore =
  typeof window !== "undefined"
    ? createStore("ytubic-cache", "query-cache")
    : undefined;

const idbStorage = {
  getItem: (key: string) =>
    idbStore
      ? get<string>(key, idbStore).then((v) => v ?? null)
      : Promise.resolve(null),
  setItem: (key: string, value: string) =>
    idbStore ? set(key, value, idbStore) : Promise.resolve(),
  removeItem: (key: string) =>
    idbStore ? del(key, idbStore) : Promise.resolve(),
};

/**
 * Persist the entire query cache to IndexedDB. On next launch the
 * `PersistQueryClientProvider` rehydrates queries from disk and shows
 * cached data instantly while a background refetch happens per
 * staleTime. Keys we don't want on disk (e.g. search by query) get
 * filtered out via `dehydrateOptions`.
 */
export const persister = createAsyncStoragePersister({
  storage: idbStorage,
  key: "ytubic-query-cache",
  throttleTime: 5000,
});

// One-time migration: the query cache used to live at this localStorage
// key. Drop the stale blob so its quota is actually reclaimed — leaving
// it in place would defeat the point of moving to IndexedDB.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem("ytubic-query-cache");
  } catch {
    // Nothing to reclaim if this throws — same best-effort shape as
    // `safeLocalStorage`.
  }
}

export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

/** Which query keys are worth persisting across launches. */
export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  return (
    head === "home" ||
    head === "artist" ||
    head === "album" ||
    // Persisted so heart fills are correct on reload — fetching the
    // full list is 7+ continuation round-trips, you don't want to pay
    // that on every cold start.
    head === "liked-songs" ||
    // Lyrics are immutable per (title, artist, album, duration) tuple
    // and the LRCLIB / YTM round-trip is the slowest part of
    // a track switch. Persisting collapses repeat plays of the same
    // track across sessions to a free disk-cache hit. The
    // `staleTime: ONE_HOUR` in `useLyricsSources` still triggers a
    // background revalidate so newly-added LRCLIB entries surface
    // within an hour of the next play.
    head === "lyrics"
  );
}

/**
 * Hard ceiling per persisted query. Beyond this size the cost of
 * serializing + writing to disk on every mutation outweighs the
 * cold-start win. Liked-songs accounts of 5k+ tracks easily blow past
 * this, but the in-session fetch is fast enough that not persisting them
 * costs ~5 s on first cold start instead of frame-blocking serializes
 * forever after.
 */
const MAX_PERSIST_BYTES_PER_QUERY = 250 * 1024;

/**
 * Cheap-but-meaningful size estimate for a query's `data`. We don't
 * reach for `JSON.stringify` here since the persister itself will
 * stringify on dehydrate; `JSON.stringify` is what gets called
 * downstream so its byte count is the only one that matters.
 */
export function fitsInPersistBudget(data: unknown): boolean {
  try {
    return JSON.stringify(data).length <= MAX_PERSIST_BYTES_PER_QUERY;
  } catch {
    return false;
  }
}
