import type { StateStorage } from "zustand/middleware";
import { createStore, del, get, set } from "idb-keyval";

/**
 * IndexedDB-backed storage for zustand's `persist` middleware.
 *
 * Usage-driven data caches (track metadata, song/video source aliases, ...)
 * used to live in `localStorage` next to every small settings store, sharing
 * its tight WebKitGTK quota. Growing without bound, they were the ones
 * eating that shared quota and causing unrelated preference writes to fail
 * (see `safeLocalStorage`) — the same problem the query cache had (see
 * `query-client.ts`). Moving them here frees `localStorage` for genuine
 * settings only.
 *
 * Deliberately a separate IndexedDB database from the query cache
 * (`ytubic-cache` / `query-cache` in `query-client.ts`): `idb-keyval`'s
 * `createStore` opens a database with exactly one object store, so a second
 * store in that same database would require a version-bumped upgrade. All
 * stores using this helper share one `kv` object store, keyed by their own
 * zustand `persist` `name` — no collisions.
 */
const idbStore =
  typeof window !== "undefined" ? createStore("ytubic-stores", "kv") : undefined;

/**
 * Zustand `StateStorage` backed by IndexedDB. Like `safeLocalStorage`,
 * failures are swallowed (never thrown) so a write failure can't propagate
 * to the nearest error boundary and blank the app mid-playback — losing one
 * write is harmless.
 */
export const safeIdbStorage: StateStorage = {
  getItem: async (name) => {
    if (!idbStore) return null;
    try {
      const value = await get<string>(name, idbStore);
      return value ?? null;
    } catch (e) {
      console.warn(`[idb-storage] failed to read "${name}":`, e);
      return null;
    }
  },
  setItem: async (name, value) => {
    if (!idbStore) return;
    try {
      await set(name, value, idbStore);
    } catch (e) {
      console.warn(`[idb-storage] failed to persist "${name}":`, e);
    }
  },
  removeItem: async (name) => {
    if (!idbStore) return;
    try {
      await del(name, idbStore);
    } catch (e) {
      console.warn(`[idb-storage] failed to remove "${name}":`, e);
    }
  },
};

/**
 * One-time migration helper: a store used to persist to `localStorage`
 * under `key` and now persists to `safeIdbStorage` instead. Drop the stale
 * `localStorage` blob so its quota is actually reclaimed — leaving it in
 * place would defeat the point of moving off it. Mirrors the migration in
 * `query-client.ts`.
 */
export function dropLegacyLocalStorageKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to reclaim if this throws — same best-effort shape as
    // `safeLocalStorage`.
  }
}
