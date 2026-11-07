import type { ShelfItem } from "./types";
import {
  fetchRadio,
  fetchRadioPage,
  fetchWatchQueueContinuation,
} from "./radio";
import { usePlaybackSettings } from "@/lib/store/playback-settings";

/**
 * YouTube Music's radio for a given seed is close to deterministic: the same
 * ~25 tracks in nearly the same order every time, and autoplay always seeds
 * on the last queued track. This widens the pool (extra continuation pages),
 * drops what was already served or queued, partially shuffles the order, and
 * keeps the same artist from playing twice in a row. The result still leans
 * towards the most related tracks; it is just no longer the same list.
 */

/** How many later pages of the station to pull in besides the first. */
const EXTRA_PAGES = 2;
/** Give up on the extra pages after this long and use what we have. */
const EXTRA_PAGES_BUDGET_MS = 2500;
/** 0 keeps YTM's order, higher mixes more (fraction of the pool size). */
const SHUFFLE_STRENGTH = 0.6;
/** Recently served tracks are skipped for later batches this session. */
const RECENT_LIMIT = 150;
/** Below this many fresh tracks the "recently served" filter is dropped. */
const MIN_FRESH = 8;

const recentlyServed: string[] = [];

function remember(ids: string[]) {
  for (const id of ids) {
    const at = recentlyServed.indexOf(id);
    if (at >= 0) recentlyServed.splice(at, 1);
    recentlyServed.push(id);
  }
  if (recentlyServed.length > RECENT_LIMIT) {
    recentlyServed.splice(0, recentlyServed.length - RECENT_LIMIT);
  }
}

const primaryArtist = (t: ShelfItem): string =>
  (t.artists?.[0]?.name ?? t.subtitle ?? "").toLowerCase();

/**
 * Order `items` by rank plus random jitter: the earlier a track is in the
 * original list, the likelier it stays early, but any track can move a long
 * way. Then spread out repeats of the same artist where the pool allows it.
 * Pure apart from `rand`, which tests can replace.
 */
export function diversify<T extends ShelfItem>(
  items: T[],
  rand: () => number = Math.random,
): T[] {
  const spread = items.length * SHUFFLE_STRENGTH;
  const out = items
    .map((t, i) => ({ t, k: i + rand() * spread }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);

  for (let i = 1; i < out.length; i++) {
    if (primaryArtist(out[i]) !== primaryArtist(out[i - 1])) continue;
    if (primaryArtist(out[i]) === "") continue;
    for (let j = i + 1; j < out.length; j++) {
      if (primaryArtist(out[j]) !== primaryArtist(out[i - 1])) {
        [out[i], out[j]] = [out[j], out[i]];
        break;
      }
    }
  }
  return out;
}

export type RadioOptions = {
  /** Ids that must not come back (the queue so far). */
  exclude?: Iterable<string>;
  /** Other recently played ids to seed from instead of `seedId` sometimes. */
  alternateSeeds?: string[];
  /** Most tracks to return. */
  limit?: number;
  /** Put the seed track itself first, for callers that do not have it. */
  includeSeed?: boolean;
};

/**
 * Radio tracks for `seedId`: varied when the setting is on, otherwise the
 * station exactly as YouTube Music returns it. The seed itself is never in
 * the result.
 */
export async function fetchVariedRadio(
  seedId: string,
  opts: RadioOptions = {},
): Promise<ShelfItem[]> {
  if (!usePlaybackSettings.getState().radioVariety) {
    const all = await fetchRadio(seedId);
    return opts.includeSeed ? all : all.filter((t) => t.id !== seedId);
  }

  // Autoplay always seeds on the tail track, which is half of why the
  // result repeats. Sometimes seed on one of the last few played instead.
  const alternates = (opts.alternateSeeds ?? []).filter((id) => id !== seedId);
  const seed =
    alternates.length > 0 && Math.random() < 0.5
      ? alternates[Math.floor(Math.random() * alternates.length)]
      : seedId;

  const first = await fetchRadioPage(seed);
  let pool = first.tracks;

  if (first.continuationToken) {
    let token: string | undefined = first.continuationToken;
    const more = (async () => {
      const got: ShelfItem[] = [];
      for (let p = 0; p < EXTRA_PAGES && token; p++) {
        const page = await fetchWatchQueueContinuation(token);
        got.push(...page.tracks);
        token = page.continuationToken;
      }
      return got;
    })().catch(() => [] as ShelfItem[]);
    const timeout = new Promise<ShelfItem[]>((resolve) =>
      setTimeout(() => resolve([]), EXTRA_PAGES_BUDGET_MS),
    );
    pool = pool.concat(await Promise.race([more, timeout]));
  }

  const blocked = new Set<string>([seedId, seed, ...(opts.exclude ?? [])]);
  const seen = new Set<string>();
  const unique = pool.filter((t) => {
    if (blocked.has(t.id) || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  const recent = new Set(recentlyServed);
  const fresh = unique.filter((t) => !recent.has(t.id));
  const candidates = fresh.length >= MIN_FRESH ? fresh : unique;

  const result = diversify(candidates).slice(0, opts.limit ?? 30);
  remember(result.map((t) => t.id));
  const seedItem = opts.includeSeed
    ? first.tracks.find((t) => t.id === seedId)
    : undefined;
  return seedItem ? [seedItem, ...result] : result;
}
