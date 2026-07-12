import { scrobble, type LastfmCreds, type LastfmScrobbleTrack } from "@/lib/lastfm/api";
import { safeLocalStorage } from "@/lib/store/safe-storage";

/**
 * Offline scrobble retry queue. A scrobble that can't reach Last.fm right
 * now (offline, a transient server hiccup) is persisted here and retried
 * once connectivity/service comes back, so a listening session survives a
 * dropped connection instead of silently losing scrobbles.
 *
 * Each entry carries its own `sessionKey` so a reconnect as a different
 * Last.fm account never mis-attributes a stranded scrobble to the wrong
 * user.
 */

const STORAGE_KEY = "ytm-lastfm-queue";
/** Hard cap so a long offline stretch can't grow the queue unbounded;
 *  oldest entries are dropped first. */
const MAX_QUEUE_SIZE = 200;

export type PendingScrobble = LastfmScrobbleTrack & {
  timestamp: number;
  sessionKey: string;
};

function readQueue(): PendingScrobble[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingScrobble[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingScrobble[]): void {
  safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

/** Queue a scrobble that couldn't be sent right now. */
export function enqueue(entry: PendingScrobble): void {
  const queue = readQueue();
  queue.push(entry);
  while (queue.length > MAX_QUEUE_SIZE) queue.shift();
  writeQueue(queue);
}

/** Last.fm error codes that are transient and worth retrying later:
 *  11 = service offline, 16 = temporarily unavailable, 29 = rate limited. */
export function isTransient(e: unknown): boolean {
  const code = (e as { code?: number } | undefined)?.code;
  // No `.code` at all means a transport/HTTP failure rather than an API
  // error response — also transient.
  return code === undefined || code === 11 || code === 16 || code === 29;
}

let flushing = false;

/**
 * Drain the queue, sending entries one at a time (oldest first). Stops on
 * the first transient failure to preserve ordering and avoid hammering a
 * still-down service; drops entries whose `sessionKey` no longer matches
 * (stale account) or that Last.fm permanently rejects (bad session/sig),
 * since retrying those forever would only grow the queue.
 */
export async function flushQueue(
  creds: LastfmCreds,
  sessionKey: string,
): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let queue = readQueue();
    while (queue.length > 0) {
      const entry = queue[0];
      if (entry.sessionKey !== sessionKey) {
        queue = queue.slice(1);
        writeQueue(queue);
        continue;
      }
      try {
        await scrobble(creds, sessionKey, entry, entry.timestamp);
        queue = queue.slice(1);
        writeQueue(queue);
      } catch (e) {
        if (isTransient(e)) return; // keep it queued, stop draining for now
        queue = queue.slice(1); // permanent rejection — drop it
        writeQueue(queue);
      }
    }
  } finally {
    flushing = false;
  }
}
